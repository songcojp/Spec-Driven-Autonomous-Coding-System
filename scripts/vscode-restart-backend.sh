#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${AUTOBUILD_PORT:-43117}"
WORKER_MODE="${AUTOBUILD_WORKER_MODE:-embedded}"
PID_FILE="${ROOT_DIR}/.autobuild/vscode-backend.pid"
LOG_DIR="${ROOT_DIR}/.autobuild/logs"
LOG_FILE="${LOG_DIR}/vscode-backend.log"
EXTENSION_DIR="${ROOT_DIR}/apps/vscode-extension"

cd "${ROOT_DIR}"

mkdir -p "${LOG_DIR}" "$(dirname "${PID_FILE}")"

stop_pid_file_process() {
  if [ ! -f "${PID_FILE}" ]; then
    return
  fi

  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
    echo "Stopping previous VSCode backend process ${pid}..."
    kill "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -9 "${pid}" 2>/dev/null || true
  fi

  rm -f "${PID_FILE}"
}

stop_port_processes() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local pids
  pids="$(lsof -t -i:"${BACKEND_PORT}" -sTCP:LISTEN || true)"
  for pid in ${pids}; do
    echo "Stopping process ${pid} listening on port ${BACKEND_PORT}..."
    kill "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -9 "${pid}" 2>/dev/null || true
  done
}

wait_for_health() {
  local url="http://127.0.0.1:${BACKEND_PORT}/health"
  for _ in $(seq 1 60); do
    if node -e "fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "${url}" >/dev/null 2>&1; then
      echo "SpecDrive backend is ready at ${url}."
      return
    fi
    sleep 0.5
  done

  echo "SpecDrive backend did not become healthy. Last log lines:" >&2
  tail -n 40 "${LOG_FILE}" >&2 || true
  exit 1
}

build_backend_runtime() {
  echo "Building SpecDrive IDE extension..."
  npm run ide:build

  echo "Bundling SpecDrive Control Plane server..."
  rm -rf "${EXTENSION_DIR}/server"
  mkdir -p "${EXTENSION_DIR}/server"
  npx --yes esbuild src/index.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --target=node20 \
    --banner:js='const { pathToFileURL: __specdrivePathToFileURL } = require("url"); const import_meta_url = __specdrivePathToFileURL(__filename).href;' \
    --define:import.meta.url=import_meta_url \
    --outfile="${EXTENSION_DIR}/server/index.cjs"
}

if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use --silent
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${node_major}" -lt 24 ]; then
  echo "Node.js >=24 is required. Current version: $(node -v)" >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

build_backend_runtime

if command -v docker >/dev/null 2>&1; then
  echo "Starting Redis via Docker Compose..."
  docker compose up -d redis

  echo "Waiting for Redis to be healthy..."
  for _ in $(seq 1 20); do
    if docker compose ps redis --format json | grep -q '"Health":"healthy"'; then
      echo "Redis is healthy."
      break
    fi
    sleep 0.5
  done
else
  echo "Warning: docker command not found. Redis must be running at AUTOBUILD_REDIS_URL or 127.0.0.1:6379." >&2
fi

stop_pid_file_process
stop_port_processes

backend_args=(--port "${BACKEND_PORT}")
if [ "${WORKER_MODE}" = "off" ]; then
  backend_args+=(--no-worker)
elif [ "${WORKER_MODE}" = "worker-only" ]; then
  backend_args+=(--worker-only)
fi

echo "Starting SpecDrive backend on http://127.0.0.1:${BACKEND_PORT} with worker mode ${WORKER_MODE}..."
AUTOBUILD_PORT="${BACKEND_PORT}" AUTOBUILD_WORKER_MODE="${WORKER_MODE}" \
  setsid node src/index.ts "${backend_args[@]}" >"${LOG_FILE}" 2>&1 < /dev/null &
echo "$!" > "${PID_FILE}"

wait_for_health
