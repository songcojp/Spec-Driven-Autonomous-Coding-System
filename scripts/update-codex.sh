#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_PACKAGE="${CODEX_PACKAGE:-@openai/codex}"
CODEX_VERSION="${1:-${CODEX_VERSION:-latest}}"

cd "${ROOT_DIR}"

# Check node version
node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${node_major}" -lt 24 ]; then
  echo "Node.js >=24 is required. Current version: $(node -v)" >&2
  exit 1
fi

echo "Using node: $(command -v node) ($(node -v))"
echo "Using npm:  $(command -v npm) ($(npm -v))"
echo "Updating Codex package: ${CODEX_PACKAGE}@${CODEX_VERSION}"

npm install -g "${CODEX_PACKAGE}@${CODEX_VERSION}"

echo
echo "Codex binary: $(command -v codex)"
codex --version
npm ls -g "${CODEX_PACKAGE}" --depth=0
