#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TTS_PORT="${TTS_PORT:-8091}"
OUTPUT_DIR="${DEPLOY_DIR}/output"
OUTPUT_PATH="${OUTPUT_DIR}/stream_test.pcm"
mkdir -p "${OUTPUT_DIR}"

curl --fail --silent --show-error --no-buffer \
  --max-time 300 \
  -X POST "http://127.0.0.1:${TTS_PORT}/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "input": "你好，这是流式语音合成测试。音频正在逐块返回。",
    "voice": "vivian",
    "language": "Chinese",
    "instructions": "用自然、清晰、友好的语气说",
    "stream": true,
    "stream_format": "audio",
    "response_format": "pcm"
  }' \
  --output "${OUTPUT_PATH}"

PCM_BYTES="$(stat -c %s "${OUTPUT_PATH}")"
if (( PCM_BYTES == 0 || PCM_BYTES % 2 != 0 )); then
  echo "Invalid PCM output size: ${PCM_BYTES} bytes" >&2
  exit 1
fi

awk -v bytes="${PCM_BYTES}" 'BEGIN { printf "PCM: %d bytes, 24 kHz mono, duration %.3f seconds\n", bytes, bytes / 48000 }'
