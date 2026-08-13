#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
RUN_DIR="${DEPLOY_DIR}/run"
ENV_DIR="${PROJECT_DIR}/.venv-vllm-ui"
SESSION_NAME="${TTS_UI_SESSION_NAME:-qwen3-tts-pro-ui}"

TTS_API_BASE="${TTS_API_BASE:-http://127.0.0.1:8091}"
UI_HOST="${UI_HOST:-0.0.0.0}"
UI_PORT="${UI_PORT:-7860}"

mkdir -p "${RUN_DIR}"

if [[ ! -x "${ENV_DIR}/bin/python" ]]; then
  echo "Web UI environment is missing. Run ./deployment/install_vllm_tts_ui.sh first." >&2
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required to keep the Web UI running." >&2
  exit 1
fi

if ! curl -fsS "${TTS_API_BASE}/health" >/dev/null; then
  echo "Qwen3-TTS API is not healthy at ${TTS_API_BASE}." >&2
  exit 1
fi

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "Qwen3-TTS Web UI is already running in tmux session ${SESSION_NAME}."
  exit 0
fi

PID_FILE="${RUN_DIR}/ui.pid"
LOG_FILE="${RUN_DIR}/ui.log"
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(<"${PID_FILE}")"
  OLD_STATE="$(ps -o stat= -p "${OLD_PID}" 2>/dev/null || true)"
  if [[ -n "${OLD_STATE}" && "${OLD_STATE}" != Z* ]]; then
    echo "Qwen3-TTS Web UI is already running (PID ${OLD_PID})."
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

if ss -ltn "sport = :${UI_PORT}" | grep -q LISTEN; then
  echo "Port ${UI_PORT} is already in use." >&2
  exit 1
fi

printf -v SESSION_COMMAND 'env TTS_API_BASE=%q UI_HOST=%q UI_PORT=%q %q' \
  "${TTS_API_BASE}" "${UI_HOST}" "${UI_PORT}" "${DEPLOY_DIR}/run_vllm_tts_ui_foreground.sh"
tmux new-session -d -s "${SESSION_NAME}" "${SESSION_COMMAND}"

for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${UI_PORT}/" >/dev/null 2>&1; then
    UI_PID="$(<"${PID_FILE}")"
    echo "Started Qwen3-TTS Web UI (PID ${UI_PID}); log: ${LOG_FILE}"
    echo "Open http://<server-ip>:${UI_PORT}"
    exit 0
  fi
  sleep 1
done

echo "Qwen3-TTS Web UI failed to start; check ${LOG_FILE}" >&2
exit 1
