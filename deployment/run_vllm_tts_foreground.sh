#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
ENV_DIR="${TTS_ENV_DIR:-${PROJECT_DIR}/.venv-vllm-omni-0.26}"
RUN_DIR="${DEPLOY_DIR}/run"
MODEL_ID="${TTS_MODEL:-Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice}"
CONFIG_PATH="${TTS_DEPLOY_CONFIG:-${DEPLOY_DIR}/qwen3_tts_pro.yaml}"

if [[ "${ENV_DIR}" != /* ]]; then
  ENV_DIR="${PROJECT_DIR}/${ENV_DIR}"
fi

TTS_GPU="${TTS_GPU:-0}"
TTS_HOST="${TTS_HOST:-0.0.0.0}"
TTS_PORT="${TTS_PORT:-8091}"

HF_CACHE_DIR="${TTS_HF_HOME:-${DEPLOY_DIR}/cache/huggingface}"
mkdir -p "${RUN_DIR}" "${HF_CACHE_DIR}"
echo "$$" >"${RUN_DIR}/server.pid"

export CUDA_VISIBLE_DEVICES="${TTS_GPU}"
export HF_HOME="${HF_CACHE_DIR}"
# First launch downloads model weights. Set both overrides to 1 for offline
# production restarts after the snapshot is cached.
export HF_HUB_OFFLINE="${TTS_HF_HUB_OFFLINE:-0}"
export TRANSFORMERS_OFFLINE="${TTS_TRANSFORMERS_OFFLINE:-0}"
export PYTHONUNBUFFERED=1
export PATH="${ENV_DIR}/bin:${PATH}"
export QWEN3_TTS_CODE2WAV_BATCH_STATS="${QWEN3_TTS_CODE2WAV_BATCH_STATS:-0}"
export QWEN3_TTS_CODE2WAV_BATCH_STATS_LOG_EVERY="${QWEN3_TTS_CODE2WAV_BATCH_STATS_LOG_EVERY:-100}"

exec "${ENV_DIR}/bin/vllm" serve "${MODEL_ID}" \
  --omni \
  --deploy-config "${CONFIG_PATH}" \
  --host "${TTS_HOST}" \
  --port "${TTS_PORT}" \
  --trust-remote-code \
  >>"${RUN_DIR}/server.log" 2>&1
