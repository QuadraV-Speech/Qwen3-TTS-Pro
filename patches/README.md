# vLLM-Omni patch

`vllm-omni-v0.26-qwen3-tts-pro.patch` 的唯一支持基线是：

- 仓库：`https://github.com/vllm-project/vllm-omni.git`
- tag：`v0.26.0`
- 基线提交：`a4ea67a`
- 许可证：Apache-2.0

补丁包含 15 个文件、约 1,871 行新增代码和对应测试，主要实现：

- Qwen3-TTS `input.plan` / `input.tokens` 模型级输入协议；
- 运行中 Talker 请求的文本 Token 热追加；
- 条件不足时暂停调度，保持请求与 KV 状态；
- Text EOS、内部 PAD 与收尾行为；
- Talker → Code2Wav 流式 Chunk 传输；
- 初始 Code2Wav 小 Chunk、上下文裁剪和批处理路径；
- 可选 Codec Rendezvous 实验，默认配置关闭；
- 调度、Connector、API、Talker 和预处理单元测试。

应用：

```bash
git clone --depth 1 --branch v0.26.0 \
  https://github.com/vllm-project/vllm-omni.git \
  third_party/vllm-omni

git -C third_party/vllm-omni apply --check \
  ../../patches/vllm-omni-v0.26-qwen3-tts-pro.patch
git -C third_party/vllm-omni apply \
  ../../patches/vllm-omni-v0.26-qwen3-tts-pro.patch
```

不要在其他版本上强制应用。升级 vLLM-Omni 时应重新生成补丁、检查上游是否已经实现等价能力，并重新运行流式协议与并发测试。
