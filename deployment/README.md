# Deployment files

此目录只包含运行配置、服务生命周期脚本、测试客户端与 WebUI。环境安装和 vLLM-Omni 补丁应用请先阅读 [`docs/installation.md`](../docs/installation.md)。

## 文件说明

| 路径 | 用途 |
| --- | --- |
| `qwen3_tts_pro.yaml` | vLLM-Omni 0.26 双阶段并发配置 |
| `start_vllm_tts.sh` / `stop_vllm_tts.sh` | 推理服务生命周期 |
| `start_vllm_tts_ui.sh` / `stop_vllm_tts_ui.sh` | WebUI 生命周期 |
| `qwen3_tts_webui.py` | FastAPI 同源 HTTP/WebSocket 代理 |
| `webui/` | 暗色前端与双轨自回归可视化 |
| `test_vllm_tts.sh` | 完整 WAV 冒烟测试 |
| `test_vllm_tts_stream.sh` | HTTP PCM 输出流测试 |
| `test_vllm_tts_text_stream.py` | 模型级增量 Token 输入测试 |

## 常用命令

```bash
./deployment/start_vllm_tts.sh
./deployment/start_vllm_tts_ui.sh

tail -f deployment/run/server.log
tail -f deployment/run/ui.log

./deployment/test_vllm_tts.sh
./deployment/test_vllm_tts_stream.sh
.venv-vllm-omni-0.26/bin/python deployment/test_vllm_tts_text_stream.py
```

默认端口为 API `8091`、WebUI `7860`。常用覆盖参数：

```bash
TTS_GPU=0 TTS_PORT=8091 ./deployment/start_vllm_tts.sh
TTS_API_BASE=http://127.0.0.1:8091 UI_PORT=7860 ./deployment/start_vllm_tts_ui.sh
```

完整参数、离线启动和故障排查见 [`docs/deployment.md`](../docs/deployment.md)。
