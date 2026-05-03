#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSIX_FILE="${1:-${VSIX_FILE:-${ROOT_DIR}/specdrive-ide.vsix}}"
CODE_BIN="${CODE_BIN:-code}"
SKIP_PACKAGE="${SKIP_PACKAGE:-0}"
VERIFY_INSTALL="${VERIFY_INSTALL:-1}"
EXTENSION_ID="${EXTENSION_ID:-specdrive.specdrive-ide}"

cd "${ROOT_DIR}"

if ! command -v "${CODE_BIN}" >/dev/null 2>&1; then
  echo "VSCode CLI was not found: ${CODE_BIN}" >&2
  echo "Set CODE_BIN to the VSCode-compatible CLI command if needed." >&2
  exit 1
fi

if [ "${SKIP_PACKAGE}" != "1" ] || [ ! -f "${VSIX_FILE}" ]; then
  bash "${ROOT_DIR}/scripts/package-vsix.sh" "${VSIX_FILE}"
fi

if [ ! -f "${VSIX_FILE}" ]; then
  echo "VSIX file was not found after packaging: ${VSIX_FILE}" >&2
  exit 1
fi

echo "Installing VSIX with ${CODE_BIN}: ${VSIX_FILE}"
"${CODE_BIN}" --install-extension "${VSIX_FILE}" --force

if [ "${VERIFY_INSTALL}" = "1" ]; then
  echo "Verifying installed extension: ${EXTENSION_ID}"
  "${CODE_BIN}" --list-extensions | grep -i -x "${EXTENSION_ID}"
fi

echo "Installed extension: ${EXTENSION_ID}"
