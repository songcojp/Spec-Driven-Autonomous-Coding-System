#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${AUTOBUILD_PORT:-4317}"
FRONTEND_PORT="${CONSOLE_PORT:-5173}"
CONSOLE_API_BASE_URL="${CONSOLE_API_BASE_URL:-http://localhost:${BACKEND_PORT}}"
WORKER_MODE="${AUTOBUILD_WORKER_MODE:-embedded}"

COMMAND="${1:-start}"

cd "${ROOT_DIR}"

kill_port_process() {
  local port=$1
  local pids
  pids=$(lsof -t -i:"$port" -sTCP:LISTEN || true)
  for pid in $pids; do
    echo "Killing process $pid occupying port $port..."
    kill -9 "$pid" 2>/dev/null || true
  done
}

check_port_conflict() {
  local port=$1
  local pids
  pids=$(lsof -t -i:"$port" -sTCP:LISTEN || true)
  if [ -n "$pids" ]; then
    echo "Error: Port $port is already in use by process(es): $pids." >&2
    exit 1
  fi
}

stop_services() {
  echo "Stopping services..."
  kill_port_process "$BACKEND_PORT"
  kill_port_process "$FRONTEND_PORT"

  if command -v docker >/dev/null 2>&1; then
    echo "Stopping Redis container..."
    docker compose stop redis || true
  fi
}

start_services() {
  check_port_conflict "$BACKEND_PORT"
  check_port_conflict "$FRONTEND_PORT"

  if command -v nvm >/dev/null 2>&1; then
    nvm use --silent
  elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use --silent
  fi

  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [ "${node_major}" -lt 24 ]; then
    echo "Node.js >=24 is required. Current version: $(node -v)" >&2
    echo "Run 'nvm use' from the repo root, then retry." >&2
    exit 1
  fi

  if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
  fi

  if command -v docker >/dev/null 2>&1; then
    echo "Starting Redis via Docker Compose..."
    docker compose up -d redis

    echo "Waiting for Redis to be healthy..."
    MAX_RETRIES=10
    RETRY_COUNT=0
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
      if docker compose ps redis --format json | grep -q '"Health":"healthy"'; then
        echo "Redis is healthy."
        break
      fi
      RETRY_COUNT=$((RETRY_COUNT + 1))
      sleep 1
    done
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
      echo "Warning: Redis health check timed out. Proceeding anyway..."
    fi
  else
    echo "Warning: docker command not found. Skipping Redis startup."
  fi

  cleanup() {
    echo "Cleaning up processes..."
    if [ "${BACKEND_PID:-}" ]; then
      kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    fi
    if [ "${FRONTEND_PID:-}" ]; then
      kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
    fi
    if [ "${WORKER_PID:-}" ]; then
      kill "${WORKER_PID}" >/dev/null 2>&1 || true
    fi
    # Optionally stop redis on exit, but usually better to keep it running for fast restarts
    # docker compose stop redis >/dev/null 2>&1 || true
  }

  trap cleanup EXIT INT TERM

  local backend_worker_arg=()
  if [ "$WORKER_MODE" = "off" ] || [ "$WORKER_MODE" = "worker-only" ]; then
    backend_worker_arg=(--no-worker)
  fi

  echo "Starting SpecDrive AutoBuild backend with hot reload on http://localhost:${BACKEND_PORT}"
  npm run backend:dev -- --port "${BACKEND_PORT}" "${backend_worker_arg[@]}" &
  BACKEND_PID="$!"

  if [ "$WORKER_MODE" = "worker-only" ]; then
    echo "Starting SpecDrive BullMQ worker with hot reload"
    npm run backend:dev -- --worker-only &
    WORKER_PID="$!"
  fi

  echo "Starting Product Console frontend with hot reload on http://localhost:${FRONTEND_PORT}"
  CONSOLE_API_BASE_URL="${CONSOLE_API_BASE_URL}" npm run console:dev -- --port "${FRONTEND_PORT}" &
  FRONTEND_PID="$!"

  echo
  echo "Product Console: http://localhost:${FRONTEND_PORT}"
  echo "Backend health:  http://localhost:${BACKEND_PORT}/health"
  echo "Worker mode:     ${WORKER_MODE} (Redis started via Docker)"
  echo "Press Ctrl+C to stop all processes."
  echo

  wait -n "${BACKEND_PID}" "${FRONTEND_PID}" ${WORKER_PID:+"${WORKER_PID}"}
}

case "$COMMAND" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    start_services
    ;;
  *)
    echo "Usage: $0 {start|stop|restart}"
    exit 1
    ;;
esac
