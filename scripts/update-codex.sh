#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NVM_SH="${NVM_DIR}/nvm.sh"
CODEX_PACKAGE="${CODEX_PACKAGE:-@openai/codex}"
CODEX_VERSION="${1:-${CODEX_VERSION:-latest}}"

if [ ! -s "${NVM_SH}" ]; then
  echo "nvm is required but was not found at ${NVM_SH}" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "${NVM_SH}"

cd "${ROOT_DIR}"

if [ -f ".nvmrc" ]; then
  nvm use --silent
else
  nvm use --silent 24
fi

echo "Using node: $(command -v node) ($(node -v))"
echo "Using npm:  $(command -v npm) ($(npm -v))"
echo "Updating Codex package: ${CODEX_PACKAGE}@${CODEX_VERSION}"

npm install -g "${CODEX_PACKAGE}@${CODEX_VERSION}"

echo
echo "Codex binary: $(command -v codex)"
codex --version
npm ls -g "${CODEX_PACKAGE}" --depth=0
