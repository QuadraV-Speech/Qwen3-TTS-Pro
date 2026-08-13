#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${DEPLOY_DIR}/run/ui.pid"
SESSION_NAME="${TTS_UI_SESSION_NAME:-qwen3-tts-pro-ui}"

if [[ ! -f "${PID_FILE}" ]]; then
  tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
  echo "Qwen3-TTS Web UI is not running (PID file not found)."
  exit 0
fi

UI_PID="$(<"${PID_FILE}")"
UI_STATE="$(ps -o stat= -p "${UI_PID}" 2>/dev/null || true)"
if [[ -z "${UI_STATE}" || "${UI_STATE}" == Z* ]]; then
  rm -f "${PID_FILE}"
  tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
  echo "Qwen3-TTS Web UI is not running (stale PID file removed)."
  exit 0
fi

kill "${UI_PID}"
for _ in $(seq 1 15); do
  UI_STATE="$(ps -o stat= -p "${UI_PID}" 2>/dev/null || true)"
  if [[ -z "${UI_STATE}" || "${UI_STATE}" == Z* ]]; then
    rm -f "${PID_FILE}"
    tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
    echo "Qwen3-TTS Web UI stopped."
    exit 0
  fi
  sleep 1
done

echo "Qwen3-TTS Web UI did not stop within 15 seconds (PID ${UI_PID})." >&2
exit 1
