#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TTS_PORT="${TTS_PORT:-8091}"
OUTPUT_DIR="${DEPLOY_DIR}/output"
mkdir -p "${OUTPUT_DIR}"

curl --fail --silent --show-error \
  --max-time 300 \
  -X POST "http://127.0.0.1:${TTS_PORT}/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "input": "你好，这是 Qwen 三语音合成服务的部署测试。",
    "voice": "vivian",
    "language": "Chinese",
    "instructions": "用自然、清晰、友好的语气说",
    "response_format": "wav"
  }' \
  --output "${OUTPUT_DIR}/smoke_test.wav"

file "${OUTPUT_DIR}/smoke_test.wav"
