#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
ENV_DIR="${PROJECT_DIR}/.venv-vllm-ui"
UI_PYTHON="${UI_PYTHON:-python3}"

if [[ ! -x "${ENV_DIR}/bin/python" ]]; then
  "${UI_PYTHON}" -m venv "${ENV_DIR}"
fi

"${ENV_DIR}/bin/python" -m pip install -r "${DEPLOY_DIR}/requirements-ui.txt"

echo "Qwen3-TTS Web UI environment is ready: ${ENV_DIR}"
