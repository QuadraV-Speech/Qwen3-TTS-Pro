# 部署与运维

## 启动推理 API

```bash
TTS_GPU=0 ./deployment/start_vllm_tts.sh
tail -f deployment/run/server.log
```

默认值：

| 变量 | 默认值 |
| --- | --- |
| `TTS_MODEL` | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` |
| `TTS_GPU` | `0` |
| `TTS_HOST` | `0.0.0.0` |
| `TTS_PORT` | `8091` |
| `TTS_ENV_DIR` | `.venv-vllm-omni-0.26` |
| `TTS_DEPLOY_CONFIG` | `deployment/qwen3_tts_pro.yaml` |

检查：

```bash
curl -f http://127.0.0.1:8091/health
./deployment/test_vllm_tts.sh
./deployment/test_vllm_tts_stream.sh
```

## 启动 WebUI

```bash
./deployment/start_vllm_tts_ui.sh
tail -f deployment/run/ui.log
```

打开 `http://<server-ip>:7860`。若 API 在其他地址：

```bash
TTS_API_BASE=http://10.0.0.8:8091 UI_PORT=7860 \
  ./deployment/start_vllm_tts_ui.sh
```

## 验证模型级输入流

```bash
.venv-vllm-omni-0.26/bin/python \
  deployment/test_vllm_tts_text_stream.py \
  --text '这是模型级增量文本输入测试。'
```

输出中的 `audio_before_input_done: true` 表示音频在文本 EOS 提交之前已经返回。

## 停止服务

```bash
./deployment/stop_vllm_tts_ui.sh
./deployment/stop_vllm_tts.sh
```

脚本使用独立 tmux 会话 `qwen3-tts-pro-vllm` 与 `qwen3-tts-pro-ui`。可以分别通过 `TTS_SESSION_NAME` 和 `TTS_UI_SESSION_NAME` 覆盖。

## 生产部署提示

- WebUI 代理和 vLLM API 默认没有鉴权，不应直接暴露到公网。
- 在网关层配置 TLS、鉴权、请求体上限、并发/速率限制和超时。
- 不要在多个服务间复用同一个 `deployment/run` PID 目录。
- 先用目标硬件重新运行 c1/c4/c8/c16 基准，再调整 `max_num_seqs` 与显存利用率。
- 显存不足时应减少 CUDA Graph Capture、最大并发和模型长度，而不是让服务在压力下 OOM。
