#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="${ROOT_DIR}/apps/vscode-extension"
WORKSPACE_DIR="${1:-${VSCODE_DEBUG_WORKSPACE:-${ROOT_DIR}}}"
CODE_BIN="${CODE_BIN:-code}"
BACKEND_PORT="${AUTOBUILD_PORT:-43117}"
USER_DATA_DIR="${AUTOBUILD_VSCODE_USER_DATA_DIR:-${ROOT_DIR}/.autobuild/vscode-extension-host-user-data}"
EXTENSIONS_DIR="${AUTOBUILD_VSCODE_EXTENSIONS_DIR:-${ROOT_DIR}/.autobuild/vscode-extension-host-extensions}"

cd "${ROOT_DIR}"

use_project_node() {
  local required_version
  required_version="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || printf '24')"

  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if ! nvm use --silent; then
      echo "Node.js ${required_version} from .nvmrc is not installed or could not be activated." >&2
      echo "Run 'nvm install ${required_version}' from the repo root, then retry IDE debug." >&2
      exit 1
    fi
  fi
}

use_project_node

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${node_major}" -lt 24 ]; then
  echo "Node.js >=24 is required. Current version: $(node -v)" >&2
  if command -v nvm >/dev/null 2>&1 || [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    echo "Run 'nvm install 24 && nvm use' from the repo root, then retry IDE debug." >&2
  else
    echo "Please upgrade your system Node.js version to >=24, then retry IDE debug." >&2
  fi
  exit 1
fi

if [ ! -f "${EXTENSION_DIR}/package.json" ]; then
  echo "VSCode extension package.json was not found at ${EXTENSION_DIR}/package.json" >&2
  exit 1
fi

mkdir -p "${USER_DATA_DIR}" "${EXTENSIONS_DIR}"

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
"${CODE_BIN}" \
  --new-window \
  --user-data-dir="${USER_DATA_DIR}" \
  --extensions-dir="${EXTENSIONS_DIR}" \
  --extensionDevelopmentPath="${EXTENSION_DIR}" \
  "${WORKSPACE_DIR}"
