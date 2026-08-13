# 已知限制

## 当前支持范围

- 重点验证模型为 `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`。
- 模型级增量输入要求 `response_format=pcm` 与 `stream_audio=true`。
- 增量输入模式暂不支持 word timestamps 和 speed 调整。
- 推荐路径要求客户端预先知道完整文本，以便服务端生成稳定的 Token Plan。

## “流式输入”的定义

当前推荐实现是对完整原文统一分词后，增量提交 Token ID。它证明文本条件可以在 Talker 推理期间热追加，但不等价于对永远未知后文的任意字符流提供完善的语义连续性。`input.text` 在线分片仍属实验能力。

## Codec 可观测性

服务端向 WebUI 返回 PCM，而不是原始 16 路 Codec ID。WebUI 的 `F<n>` 根据 `1 帧 = 1,920 samples` 精确映射时间位置，但不能用于分析每层码本预测值或 MTP 内部采样过程。

## Chunk 与帧

PCM Chunk 是一次 Code2Wav 解码/传输批次，不是一个 Codec 帧。默认首批 1 帧，稳态通常 25 帧；浏览器将各批 PCM 连续排程播放。

## 性能

已有数据来自单次非独占 A100 环境。不同驱动、CUDA、GPU、声音、语言、文本长度和采样随机性都会改变 TTFP、RTF 和吞吐。公开结果应同时提供音频秒吞吐，不能只比较 req/s。

## 生产安全

默认服务没有身份验证、TLS、租户隔离、额度控制或内容审查。生产部署需要额外网关和安全策略。
