#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_PYTHON="${RUNTIME_PYTHON:-python3.12}"
ENV_DIR="${TTS_ENV_DIR:-${ROOT_DIR}/.venv-vllm-omni-0.26}"
VLLM_OMNI_DIR="${VLLM_OMNI_SOURCE_DIR:-${ROOT_DIR}/third_party/vllm-omni}"
VLLM_OMNI_REF="${VLLM_OMNI_REF:-v0.26.0}"
PATCH_PATH="${ROOT_DIR}/patches/vllm-omni-v0.26-qwen3-tts-pro.patch"
VLLM_WHEEL="${VLLM_WHEEL:-https://wheels.vllm.ai/568afb3a13806beb53bb2e6bd518269357b237c0/vllm-0.26.0%2Bcu129-cp38-abi3-manylinux_2_28_x86_64.whl}"

if ! command -v "${RUNTIME_PYTHON}" >/dev/null 2>&1; then
  echo "Python executable not found: ${RUNTIME_PYTHON}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_PATH}" ]]; then
  echo "Patch not found: ${PATCH_PATH}" >&2
  exit 1
fi

if [[ ! -x "${ENV_DIR}/bin/python" ]]; then
  "${RUNTIME_PYTHON}" -m venv "${ENV_DIR}"
fi

"${ENV_DIR}/bin/python" -m pip install --upgrade pip setuptools wheel
"${ENV_DIR}/bin/python" -m pip install "${VLLM_WHEEL}"

mkdir -p "$(dirname "${VLLM_OMNI_DIR}")"
if [[ ! -d "${VLLM_OMNI_DIR}/.git" ]]; then
  if [[ -e "${VLLM_OMNI_DIR}" ]]; then
    echo "VLLM_OMNI_SOURCE_DIR exists but is not a Git checkout: ${VLLM_OMNI_DIR}" >&2
    exit 1
  fi
  git clone --depth 1 --branch "${VLLM_OMNI_REF}" \
    https://github.com/vllm-project/vllm-omni.git "${VLLM_OMNI_DIR}"
fi

CURRENT_REF="$(git -C "${VLLM_OMNI_DIR}" describe --tags --exact-match 2>/dev/null || true)"
if [[ "${CURRENT_REF}" != "${VLLM_OMNI_REF}" ]]; then
  echo "Expected vLLM-Omni ${VLLM_OMNI_REF}, found ${CURRENT_REF:-an untagged revision}." >&2
  exit 1
fi

if git -C "${VLLM_OMNI_DIR}" apply --reverse --check "${PATCH_PATH}" >/dev/null 2>&1; then
  echo "Qwen3-TTS-Pro patch is already applied."
elif git -C "${VLLM_OMNI_DIR}" apply --check "${PATCH_PATH}"; then
  git -C "${VLLM_OMNI_DIR}" apply "${PATCH_PATH}"
  echo "Applied Qwen3-TTS-Pro patch to vLLM-Omni ${VLLM_OMNI_REF}."
else
  echo "Patch cannot be applied cleanly. Use a clean vLLM-Omni ${VLLM_OMNI_REF} checkout." >&2
  exit 1
fi

"${ENV_DIR}/bin/python" -m pip install -e "${VLLM_OMNI_DIR}"
"${ROOT_DIR}/deployment/install_vllm_tts_ui.sh"

echo "Runtime ready. Continue with: ./deployment/start_vllm_tts.sh"
