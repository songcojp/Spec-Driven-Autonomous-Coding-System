#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="${ROOT_DIR}/apps/vscode-extension"
OUT_FILE="${1:-${VSIX_OUT:-${ROOT_DIR}/specdrive-ide.vsix}}"
VSCE_PACKAGE="${VSCE_PACKAGE:-@vscode/vsce}"

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
