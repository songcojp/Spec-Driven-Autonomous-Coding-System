#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="${ROOT_DIR}/apps/vscode-extension"
WORKSPACE_DIR="${1:-${VSCODE_DEBUG_WORKSPACE:-${ROOT_DIR}}}"
CODE_BIN="${CODE_BIN:-code}"
BACKEND_PORT="${AUTOBUILD_PORT:-43117}"

cd "${ROOT_DIR}"

if [ ! -f "${EXTENSION_DIR}/package.json" ]; then
  echo "VSCode extension package.json was not found at ${EXTENSION_DIR}/package.json" >&2
  exit 1
fi

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

if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -t -i:"${BACKEND_PORT}" -sTCP:LISTEN || true)"
  for pid in ${pids}; do
    echo "Stopping stale SpecDrive debug backend ${pid} on port ${BACKEND_PORT}..."
    kill "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -9 "${pid}" 2>/dev/null || true
  done
fi

echo "Opening VSCode Extension Development Host for ${WORKSPACE_DIR}..."
"${CODE_BIN}" --new-window --extensionDevelopmentPath="${EXTENSION_DIR}" "${WORKSPACE_DIR}"
