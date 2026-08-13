#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
ENV_DIR="${PROJECT_DIR}/.venv-vllm-ui"
RUN_DIR="${DEPLOY_DIR}/run"

TTS_API_BASE="${TTS_API_BASE:-http://127.0.0.1:8091}"
UI_HOST="${UI_HOST:-0.0.0.0}"
UI_PORT="${UI_PORT:-7860}"

mkdir -p "${RUN_DIR}"
echo "$$" >"${RUN_DIR}/ui.pid"
export PYTHONUNBUFFERED=1
# The host uses an outbound HTTP proxy. Keep calls to the local vLLM API off
# that proxy, otherwise httpx returns a proxy-generated 502 for 127.0.0.1.
export NO_PROXY="${NO_PROXY:+${NO_PROXY},}127.0.0.1,localhost"
export no_proxy="${no_proxy:+${no_proxy},}127.0.0.1,localhost"

exec "${ENV_DIR}/bin/python" "${DEPLOY_DIR}/qwen3_tts_webui.py" \
  --api-base "${TTS_API_BASE}" \
  --host "${UI_HOST}" \
  --port "${UI_PORT}" \
  >>"${RUN_DIR}/ui.log" 2>&1
