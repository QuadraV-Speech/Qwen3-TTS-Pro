#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${DEPLOY_DIR}/run/server.pid"
SESSION_NAME="${TTS_SESSION_NAME:-qwen3-tts-pro-vllm}"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "Qwen3-TTS is not running (PID file not found)."
  exit 0
fi

SERVER_PID="$(<"${PID_FILE}")"
SERVER_STATE="$(ps -o stat= -p "${SERVER_PID}" 2>/dev/null || true)"
if [[ -z "${SERVER_STATE}" || "${SERVER_STATE}" == Z* ]]; then
  rm -f "${PID_FILE}"
  tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
  echo "Qwen3-TTS is not running (stale PID file removed)."
  exit 0
fi

kill "${SERVER_PID}"
for _ in $(seq 1 30); do
  SERVER_STATE="$(ps -o stat= -p "${SERVER_PID}" 2>/dev/null || true)"
  if [[ -z "${SERVER_STATE}" || "${SERVER_STATE}" == Z* ]]; then
    rm -f "${PID_FILE}"
    tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
    echo "Qwen3-TTS stopped."
    exit 0
  fi
  sleep 1
done

echo "Qwen3-TTS did not stop within 30 seconds (PID ${SERVER_PID})." >&2
exit 1
