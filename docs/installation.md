# 安装教程

本教程安装独立的 Qwen3-TTS-Pro 工程层。无需克隆或安装 Qwen3-TTS 官方 Python 仓库；模型权重由 vLLM-Omni 首次启动时从 Hugging Face 获取。

## 1. 已验证环境

- Linux x86_64
- Python 3.12
- NVIDIA GPU；当前基准使用 A100-SXM4-80GB
- vLLM `0.26.0+cu129`
- vLLM-Omni tag `v0.26.0`
- `git`、`curl`、`tmux`

建议使用至少 48 GiB 显存。显存需求会受到上下文、并发、CUDA Graph Capture 和同卡其他进程影响；当前默认配置以 80 GiB GPU 为主要验证目标。

## 2. 获取仓库

```bash
git clone https://github.com/QuadraV-Speech/Qwen3-TTS-Pro.git
cd Qwen3-TTS-Pro
```

## 3. 自动准备运行时

```bash
./scripts/setup_runtime.sh
```

该脚本只执行环境准备，不会启动服务：

1. 创建 `.venv-vllm-omni-0.26`；
2. 安装经过验证的 vLLM CUDA 12.9 wheel；
3. 将 vLLM-Omni `v0.26.0` 克隆到被 Git 忽略的 `third_party/`；
4. 应用 `patches/vllm-omni-v0.26-qwen3-tts-pro.patch`；
5. 以 editable 模式安装补丁后的 vLLM-Omni；
6. 创建独立的轻量 WebUI 环境。

可覆盖参数：

```bash
RUNTIME_PYTHON=python3.12 \
VLLM_OMNI_REF=v0.26.0 \
VLLM_WHEEL='vllm==0.26.0' \
./scripts/setup_runtime.sh
```

默认使用当前验证过的 `cu129` wheel URL。如果你的驱动或平台不同，请通过 `VLLM_WHEEL` 指定与环境匹配的官方 vLLM 安装源。

## 4. 手动安装

如果不使用脚本，可以执行：

```bash
python3.12 -m venv .venv-vllm-omni-0.26
source .venv-vllm-omni-0.26/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install 'vllm==0.26.0'

mkdir -p third_party
git clone --depth 1 --branch v0.26.0 \
  https://github.com/vllm-project/vllm-omni.git \
  third_party/vllm-omni

git -C third_party/vllm-omni apply --check \
  ../../patches/vllm-omni-v0.26-qwen3-tts-pro.patch
git -C third_party/vllm-omni apply \
  ../../patches/vllm-omni-v0.26-qwen3-tts-pro.patch

python -m pip install -e third_party/vllm-omni
deactivate

./deployment/install_vllm_tts_ui.sh
```

补丁严格针对 `v0.26.0`。不要在其他 tag 上强制使用 `--reject` 或模糊应用；升级上游时应重新 rebase 并运行测试。

## 5. 验证安装

```bash
.venv-vllm-omni-0.26/bin/python -m pip show vllm vllm-omni
VLLM_OMNI_SOURCE_DIR=third_party/vllm-omni ./scripts/validate_repo.sh
```

使用默认脚本时，预期版本分别为 vLLM `0.26.0+cu129` 和 vLLM-Omni `0.26.0`。前者的 `+cu129` 是默认 wheel 的 CUDA 构建标记；通过 `VLLM_WHEEL` 选择其他官方构建时，后缀可以不同，但核心版本必须保持 `0.26.0`。后者对应 tag `v0.26.0`、提交 `a4ea67a`；补丁应被识别为已应用。

## 6. 模型缓存与离线运行

首次启动默认允许联网并将模型写入 `deployment/cache/huggingface`。也可以复用全局缓存：

```bash
TTS_HF_HOME=/path/to/huggingface-cache ./deployment/start_vllm_tts.sh
```

权重已经完整缓存后，可启用离线模式：

```bash
TTS_HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  ./deployment/start_vllm_tts.sh
```

下一步阅读 [部署与运维](deployment.md)。
