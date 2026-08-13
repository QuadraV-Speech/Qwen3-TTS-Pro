# 模型级双流协议

端点：`WS /v1/audio/speech/stream`

## 1. 配置会话

```json
{
  "type": "session.config",
  "model": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
  "voice": "vivian",
  "language": "Chinese",
  "response_format": "pcm",
  "stream_audio": true,
  "model_streaming_input": true,
  "non_streaming_mode": false,
  "initial_codec_chunk_frames": 1
}
```

模型级输入流当前要求 PCM 输出，且不支持 word timestamps 和 speed 调整。

## 2. 获取统一 Token Plan

```json
{"type":"input.plan","text":"你好，这是双流测试。"}
```

服务端返回：

```json
{
  "type": "input.plan.ready",
  "token_ids": [101, 102, 103],
  "tokens": ["你", "好", "。"],
  "token_count": 3
}
```

这里的数字仅为协议示例。客户端必须原样、按序回传服务返回的真实 ID。

## 3. 增量提交 Token

```json
{"type":"input.tokens","token_ids":[101,102]}
{"type":"input.tokens","token_ids":[103]}
```

Talker 可以在后续 Token 尚未提交时开始生成。若条件供应不足，调度器暂停下一步而不销毁请求状态。

## 4. 结束当前输入

```json
{"type":"input.done"}
```

`input.done` 提交 Text EOS，不等同于立即停止音频。模型可能继续在内部 PAD 条件下生成句尾，直到 Codec EOS。

## 5. 服务端事件

| 事件 | 载荷 | 含义 |
| --- | --- | --- |
| `input.plan.ready` | JSON | 统一分词结果 |
| `audio.start` | JSON | 当前语句开始输出 |
| binary frame | PCM16 bytes | 24 kHz 单声道音频数据 |
| `audio.done` | JSON | 当前语句 PCM 完成 |
| `session.done` | JSON | 当前 utterance 完成；连接可复用 |
| `error` | JSON | 协议或推理错误 |

## 6. 客户端策略

当前 WebUI 先提交 24 个 Token 前瞻，保留至少一个真实内容 Token；收到首包后以每批 16 个、间隔 25 ms 继续提交，并将最后的内容 Token 与 EOS 邻近发送。这些是客户端平衡稳定性和可见双流效果的策略，不是协议硬限制。

对于真正无法预知完整原文的输入，补丁保留了 `input.text` 路径，但独立分片的 BPE 边界和语音稳定性尚未达到推荐级别，当前视为实验能力。
