# Qwen3-TTS vLLM-Omni 并发基线报告

测试日期：2026-08-11

## 测试环境

- 模型：`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- 服务：vLLM 0.20.0 + vLLM-Omni 0.20.0
- vLLM-Omni 源码：`4a24a517abc7769b1399ded594558a3fe8269872`（tag `v0.20.0`）
- GPU：单张 NVIDIA A100-SXM4-80GB
- 任务：`default_voice`，Vivian / English / CustomVoice
- 数据集：官方随仓库提供的 `seed_tts_smoke`
- 请求：并发 1、4 各 20 条，并发 8 为 80 条；每组预热 2 条；突发请求 `request-rate=inf`
- 结果口径：TTFP 与 RTF 使用中位数；RTF 越低越好，低于 1 代表快于实时生成

测试期间 GPU 并非独占：另有无关进程占用约 13.1 GiB。本报告保留这一条件，只评估当时的实际部署基线。

## 本机实测

| 并发 | 请求 | 成功率 | TTFP P50 | TTFP P99 | RTF P50 | RTF P99 | 音频吞吐 | 请求吞吐 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | 100% | 81.24 ms | 84.13 ms | 0.210 | 0.217 | 4.76 audio-s/s | 0.85 req/s |
| 4 | 20 | 100% | 159.81 ms | 234.49 ms | 0.304 | 0.317 | 12.66 audio-s/s | 2.29 req/s |
| 8 | 80 | 100% | 331.60 ms | 2623.08 ms | 0.369 | 0.758 | 19.32 audio-s/s | 3.70 req/s |

从并发 1 到并发 8，音频吞吐提升 4.06 倍，但并发增加了 8 倍。并发 4 到 8 翻倍后，音频吞吐只增加 52.6%，已经接近 Code2Wav `batch-size=1` 瓶颈。并发 8 的 P99 首包为 2.62 秒，是中位数的 7.91 倍，尾延迟需要关注。

## 对比同版本官方 CI 门槛

以下门槛来自本机所用 vLLM-Omni v0.20.0 的官方 `tests/dfx/perf/tests/test_tts.json`，任务、数据集和请求参数与本次 `default_voice` 测试一致。它们是回归测试的通过门槛，不是官方典型实测值。

| 并发 | 指标 | 官方门槛 | 本机 | 结果 |
|---:|---|---:|---:|---|
| 1 | TTFP P50 | ≤ 150 ms | 81.24 ms | 通过，低 45.8% |
| 1 | RTF P50 | ≤ 0.15 | 0.210 | 未通过，高 40.0% |
| 8 | TTFP P50 | ≤ 1500 ms | 331.60 ms | 通过，低 77.9% |
| 8 | RTF P50 | ≤ 0.30 | 0.369 | 未通过，高 23.0% |
| 8 | 音频吞吐 | ≥ 30 audio-s/s | 19.32 audio-s/s | 未通过，低 35.6% |

结论：当前部署的流式首包响应达标且余量较大，但生成 RTF 和并发 8 吞吐没有达到官方 v0.20 CI 门槛。

## 对比官方 H20 实测参考

官方 README 公布的是 H20-3e 上 `voice_design` 的预合并实测，并非本次 `default_voice`，因此只能用于观察量级，不能视为严格同条件对照。

| 并发 | 官方 H20：RTF / TTFP | 本机 A100：RTF / TTFP | 观察 |
|---:|---:|---:|---|
| 1 | 0.08 / 53 ms | 0.210 / 81 ms | 本机首包慢 53%，RTF 为 2.62 倍 |
| 4 | 0.11 / 154 ms | 0.304 / 160 ms | 首包接近，RTF 为 2.76 倍 |
| 8 | 0.21 / 872 ms | 0.369 / 332 ms | 本机中位首包更低，但 RTF 为 1.76 倍 |

官方也指出并发 4 到 8 附近会出现 TTFP 跃升和音频吞吐饱和，原因是 codec batch-size=1。当前部署也出现吞吐增幅递减，但 TTFP 中位数没有官方 H20 `voice_design` 那么陡；本机的主要差距在 RTF 和总音频吞吐。

## 运行状态与注意事项

- 所有正式请求均成功，服务测试后 `/health` 返回 200，Web UI 返回 200。
- 服务日志未发现 ERROR、OOM 或请求失败。
- 日志出现 `Code2Wav input_ids length 1 not divisible by num_quantizers 16` 警告；本次 HTTP 请求和音频统计均正常完成，但生产上线前建议单独确认该收尾帧警告是否属于 v0.20.0 的已知行为。

## 官方来源

- [vLLM-Omni v0.20.0 TTS CI 基线](https://github.com/vllm-project/vllm-omni/blob/4a24a517abc7769b1399ded594558a3fe8269872/tests/dfx/perf/tests/test_tts.json)
- [vLLM-Omni TTS 并发基线与瓶颈说明](https://github.com/vllm-project/vllm-omni/blob/4a24a517abc7769b1399ded594558a3fe8269872/benchmarks/tts/README.md#concurrency-cliff-regression-sentinel)
