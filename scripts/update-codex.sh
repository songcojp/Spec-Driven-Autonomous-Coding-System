#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NVM_SH="${NVM_DIR}/nvm.sh"
CODEX_PACKAGE="${CODEX_PACKAGE:-@openai/codex}"
CODEX_VERSION="${1:-${CODEX_VERSION:-latest}}"

# Check if NVM is available and load it if so
if [ -s "${NVM_SH}" ]; then
  # shellcheck source=/dev/null
  . "${NVM_SH}"
  if [ -f "${ROOT_DIR}/.nvmrc" ]; then
    nvm use --silent || true
  else
    nvm use --silent 24 || true
  fi
elif command -v nvm >/dev/null 2>&1; then
  if [ -f "${ROOT_DIR}/.nvmrc" ]; then
    nvm use --silent || true
  else
    nvm use --silent 24 || true
  fi
else
  echo "NVM not detected. Using system/global Node.js environment."
fi

cd "${ROOT_DIR}"

# Check that node and npm are available
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not in PATH." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not in PATH." >&2
  exit 1
fi

echo "Using node: $(command -v node) ($(node -v))"
echo "Using npm:  $(command -v npm) ($(npm -v))"
echo "Updating Codex package: ${CODEX_PACKAGE}@${CODEX_VERSION}"

npm install -g "${CODEX_PACKAGE}@${CODEX_VERSION}"

echo
if command -v codex >/dev/null 2>&1; then
  echo "Codex binary: $(command -v codex)"
  codex --version
else
  echo "Warning: codex binary not found in PATH. It might be installed in a directory not in your PATH." >&2
fi
npm ls -g "${CODEX_PACKAGE}" --depth=0 || true
