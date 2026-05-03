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

cd "${ROOT_DIR}"

if [ ! -f "${EXTENSION_DIR}/package.json" ]; then
  echo "VSCode extension package.json was not found at ${EXTENSION_DIR}/package.json" >&2
  exit 1
fi

echo "Building SpecDrive IDE extension..."
npm run ide:build

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
