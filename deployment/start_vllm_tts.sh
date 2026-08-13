#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
RUN_DIR="${DEPLOY_DIR}/run"
ENV_DIR="${TTS_ENV_DIR:-${PROJECT_DIR}/.venv-vllm-omni-0.26}"
SESSION_NAME="${TTS_SESSION_NAME:-qwen3-tts-pro-vllm}"

TTS_GPU="${TTS_GPU:-0}"
TTS_HOST="${TTS_HOST:-0.0.0.0}"
TTS_PORT="${TTS_PORT:-8091}"
TTS_DEPLOY_CONFIG="${TTS_DEPLOY_CONFIG:-${DEPLOY_DIR}/qwen3_tts_pro.yaml}"

if [[ "${ENV_DIR}" != /* ]]; then
  ENV_DIR="${PROJECT_DIR}/${ENV_DIR}"
fi

if [[ "${TTS_DEPLOY_CONFIG}" != /* ]]; then
  TTS_DEPLOY_CONFIG="${PROJECT_DIR}/${TTS_DEPLOY_CONFIG}"
fi

mkdir -p "${RUN_DIR}" "${DEPLOY_DIR}/cache/huggingface"

if [[ ! -x "${ENV_DIR}/bin/vllm" ]]; then
  echo "vLLM environment is missing: ${ENV_DIR}" >&2
  exit 1
fi

if [[ ! -f "${TTS_DEPLOY_CONFIG}" ]]; then
  echo "Deploy config is missing: ${TTS_DEPLOY_CONFIG}" >&2
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required to keep the service running." >&2
  exit 1
fi

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "Qwen3-TTS is already running in tmux session ${SESSION_NAME}."
  exit 0
fi

PID_FILE="${RUN_DIR}/server.pid"
LOG_FILE="${RUN_DIR}/server.log"
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(<"${PID_FILE}")"
  OLD_STATE="$(ps -o stat= -p "${OLD_PID}" 2>/dev/null || true)"
  if [[ -n "${OLD_STATE}" && "${OLD_STATE}" != Z* ]]; then
    echo "Qwen3-TTS is already running (PID ${OLD_PID})."
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

if ss -ltn "sport = :${TTS_PORT}" | grep -q LISTEN; then
  echo "Port ${TTS_PORT} is already in use." >&2
  exit 1
fi

printf -v SESSION_COMMAND 'env TTS_GPU=%q TTS_HOST=%q TTS_PORT=%q TTS_ENV_DIR=%q TTS_DEPLOY_CONFIG=%q %q' \
  "${TTS_GPU}" "${TTS_HOST}" "${TTS_PORT}" "${ENV_DIR}" "${TTS_DEPLOY_CONFIG}" \
  "${DEPLOY_DIR}/run_vllm_tts_foreground.sh"
tmux new-session -d -s "${SESSION_NAME}" "${SESSION_COMMAND}"

for _ in $(seq 1 10); do
  if [[ -s "${PID_FILE}" ]]; then
    SERVER_PID="$(<"${PID_FILE}")"
    if kill -0 "${SERVER_PID}" 2>/dev/null; then
      echo "Started Qwen3-TTS (PID ${SERVER_PID}); log: ${LOG_FILE}"
      exit 0
    fi
  fi
  sleep 1
done

echo "Qwen3-TTS failed to start; check ${LOG_FILE}" >&2
exit 1
