# 当前版本特性

Qwen3-TTS-Pro `v0.1.0-preview` 是独立的 Qwen3-TTS 工程增强层，当前针对：

- 模型：`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- 推理框架：vLLM / vLLM-Omni `0.26.0`
- 输出：24 kHz 单声道 PCM16 或完整音频文件

## 1. 模型级增量文本输入

普通 TTS 流式接口一次性接收完整文本，只对输出音频分块。Pro 增加了 `WS /v1/audio/speech/stream`：Talker 已开始 Codec 自回归后，客户端仍可追加文本 Token。

服务端提供 Token Plan 握手，对完整原文只做一次统一分词；客户端必须按原顺序回传准确 Token ID，避免分片重新分词改变 BPE 边界。

## 2. Talker KV 连续推理

增量文本到达时，调度器将条件热追加到正在运行的请求，不重建已经计算的 Talker KV。文本供应不足时，请求会暂停下一步 Codec 生成并等待新条件，随后从原状态继续。

`input.done` 提交 Text EOS。EOS 后模型使用内部 PAD 条件完成语句收尾，直到生成 Codec EOS。

## 3. 输入与音频输出双流

客户端可以在文本 Token 尚未全部提交时收到首个 PCM 包。当前 WebUI 策略为：

| 参数 | 默认值 |
| --- | ---: |
| 初始 Token 前瞻 | 24 |
| 后续 Token 微批 | 16 |
| 微批间隔 | 25 ms |
| 初始 Codec 解码 | 1 帧 |
| 稳态 Codec 解码 | 25 帧 |
| Code2Wav 左上下文 | 72 帧 |

这是一种模型级增量输入，而不是把多个独立 TTS 请求拼接起来。

## 4. 并发推理配置

默认配置启用 Async Scheduling、CUDA Graph、共享内存流式传输、Talker/Code2Wav 双阶段并发与相同形状 Code2Wav 合批。两个阶段均允许最多 64 个在途序列。

Codec Rendezvous 仍保留在补丁中，但默认关闭。单次 c8 A/B 中请求吞吐提高 4.13%，按音频时长归一化后仅提高 0.44%，不足以承担额外生产复杂度。

## 5. WebUI 与双轨推理图

暗色 WebUI 提供：

- CustomVoice 音色和语言选择；
- 模型级 Token 双流与完整文件两种模式；
- PCM16 Web Audio 连续排程；
- 完整 WAV 重播与下载；
- TTFB、音频时长、RTF；
- 全量 Text/Codec 上下双轨。

双轨每个推理步同列配对：上轨显示 `T<n>`、Text EOS `E`、内部 PAD `P`，下轨显示等效 Codec 时间帧 `F<n>`。一行铺满后整组双轨换行，不裁剪历史；Codec 块直接通过颜色呈现待播、当前块内进度与已播放状态。

## 6. 明确的观测边界

WebUI 从 PCM 字节数与播放时钟反推 Codec 时间帧：

```text
1 帧 = 1,920 samples = 3,840 bytes PCM16 = 80 ms
```

它没有收到帧内部 16 路原始 Codec ID，因此 `F<n>` 是精确的时间帧位置，不是可检查的 16 元码本值。详见 [已知限制](limitations.md)。
