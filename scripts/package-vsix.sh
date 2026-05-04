#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="${ROOT_DIR}/apps/vscode-extension"
ACTION="${1:-install}"
if [ "${ACTION}" = "package" ] || [ "${ACTION}" = "install" ]; then
  shift || true
else
  ACTION="package"
fi
OUT_FILE="${1:-${VSIX_OUT:-${ROOT_DIR}/specdrive-ide.vsix}}"
VSCE_PACKAGE="${VSCE_PACKAGE:-@vscode/vsce}"
CODE_BIN="${CODE_BIN:-code}"
VERIFY_INSTALL="${VERIFY_INSTALL:-1}"
EXTENSION_ID="${EXTENSION_ID:-specdrive.specdrive-ide}"
AGENTS_SOURCE_DIR="${ROOT_DIR}/.agents"
AGENTS_PACKAGE_DIR="${EXTENSION_DIR}/.agents"
PACKAGE_BACKUP_DIR=""
STAGED_PACKAGE_AGENTS="0"

cleanup_package_agents() {
  if [ "${STAGED_PACKAGE_AGENTS}" = "1" ]; then
    rm -rf "${AGENTS_PACKAGE_DIR}"
  fi
  if [ -n "${PACKAGE_BACKUP_DIR}" ] && [ -d "${PACKAGE_BACKUP_DIR}/.agents" ]; then
    mv "${PACKAGE_BACKUP_DIR}/.agents" "${AGENTS_PACKAGE_DIR}"
    rm -rf "${PACKAGE_BACKUP_DIR}"
  fi
}

trap cleanup_package_agents EXIT

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

if [ ! -d "${AGENTS_SOURCE_DIR}" ]; then
  echo "Project .agents directory was not found at ${AGENTS_SOURCE_DIR}" >&2
  exit 1
fi

echo "Staging project .agents runtime into VSIX..."
if [ -e "${AGENTS_PACKAGE_DIR}" ]; then
  PACKAGE_BACKUP_DIR="$(mktemp -d)"
  mv "${AGENTS_PACKAGE_DIR}" "${PACKAGE_BACKUP_DIR}/.agents"
fi
cp -R "${AGENTS_SOURCE_DIR}" "${AGENTS_PACKAGE_DIR}"
STAGED_PACKAGE_AGENTS="1"

echo "Packaging VSIX: ${OUT_FILE}"
(
  cd "${EXTENSION_DIR}"
  npx --yes "${VSCE_PACKAGE}" package --out "${OUT_FILE}"
)

echo "VSIX created: ${OUT_FILE}"

if [ "${ACTION}" = "install" ]; then
  if ! command -v "${CODE_BIN}" >/dev/null 2>&1; then
    echo "VSCode CLI was not found: ${CODE_BIN}" >&2
    echo "Set CODE_BIN to the VSCode-compatible CLI command if needed." >&2
    exit 1
  fi

  echo "Installing VSIX with ${CODE_BIN}: ${OUT_FILE}"
  "${CODE_BIN}" --install-extension "${OUT_FILE}" --force

  if [ "${VERIFY_INSTALL}" = "1" ]; then
    echo "Verifying installed extension: ${EXTENSION_ID}"
    "${CODE_BIN}" --list-extensions | grep -i -x "${EXTENSION_ID}"
  fi

  echo "Installed extension: ${EXTENSION_ID}"
fi
