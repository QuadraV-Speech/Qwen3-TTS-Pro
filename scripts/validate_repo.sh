#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_PATH="${ROOT_DIR}/patches/vllm-omni-v0.26-qwen3-tts-pro.patch"
VLLM_OMNI_DIR="${VLLM_OMNI_SOURCE_DIR:-}"

while IFS= read -r script; do
  bash -n "${script}"
done < <(find "${ROOT_DIR}/deployment" "${ROOT_DIR}/scripts" -type f -name '*.sh' | sort)

python3 -m py_compile \
  "${ROOT_DIR}/deployment/qwen3_tts_webui.py" \
  "${ROOT_DIR}/deployment/test_vllm_tts_text_stream.py"

if command -v node >/dev/null 2>&1; then
  node --check "${ROOT_DIR}/deployment/webui/app.js"
fi

for excluded in qwen_tts finetuning examples; do
  if [[ -e "${ROOT_DIR}/${excluded}" ]]; then
    echo "Unexpected upstream source mirror in repository: ${excluded}" >&2
    exit 1
  fi
done

if rg -n '/data/|/home/[^/]+/|wangwei' \
  "${ROOT_DIR}/deployment" "${ROOT_DIR}/docs" "${ROOT_DIR}/scripts" \
  --glob '!*.png' --glob '!*.gif' --glob '!validate_repo.sh'; then
  echo "Found a machine-specific path in publishable files." >&2
  exit 1
fi

if [[ -n "${VLLM_OMNI_DIR}" ]]; then
  if [[ ! -d "${VLLM_OMNI_DIR}/.git" ]]; then
    echo "VLLM_OMNI_SOURCE_DIR is not a Git checkout: ${VLLM_OMNI_DIR}" >&2
    exit 1
  fi
  if git -C "${VLLM_OMNI_DIR}" apply --reverse --check "${PATCH_PATH}" >/dev/null 2>&1; then
    echo "Patch status: already applied"
  else
    git -C "${VLLM_OMNI_DIR}" apply --check "${PATCH_PATH}"
    echo "Patch status: applies cleanly"
  fi
fi

echo "Repository validation passed."
