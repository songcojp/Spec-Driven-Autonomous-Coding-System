#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${AUTOBUILD_PORT:-4317}"
FRONTEND_PORT="${CONSOLE_PORT:-5173}"
CONSOLE_API_BASE_URL="${CONSOLE_API_BASE_URL:-http://localhost:${BACKEND_PORT}}"

cd "${ROOT_DIR}"

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

cleanup() {
  if [ "${BACKEND_PID:-}" ]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if [ "${FRONTEND_PID:-}" ]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting SpecDrive AutoBuild backend on http://localhost:${BACKEND_PORT}"
npm start -- --port "${BACKEND_PORT}" &
BACKEND_PID="$!"

echo "Starting Product Console frontend on http://localhost:${FRONTEND_PORT}"
CONSOLE_API_BASE_URL="${CONSOLE_API_BASE_URL}" npm run console:dev -- --port "${FRONTEND_PORT}" &
FRONTEND_PID="$!"

echo
echo "Product Console: http://localhost:${FRONTEND_PORT}"
echo "Backend health:  http://localhost:${BACKEND_PORT}/health"
echo "Press Ctrl+C to stop both processes."
echo

wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
