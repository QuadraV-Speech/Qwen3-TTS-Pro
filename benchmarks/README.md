# Benchmarks

本目录保留公开报告和聚合 JSON，不包含生成音频、用户文本数据、服务日志或硬件标识文件。

| 目录 | 内容 |
| --- | --- |
| [`a100-v026`](a100-v026/REPORT.md) | 当前 vLLM-Omni 0.26 c1/c4/c8/c16 结果 |
| [`a100-v020`](a100-v020/REPORT.md) | 同机旧版 v0.20 对照 |
| [`codec-rendezvous-ab`](codec-rendezvous-ab/REPORT.md) | 已回退的 Codec Rendezvous A/B |

推荐比较指标：

- 成功率；
- TTFP P50/P99；
- Audio RTF P50/P99；
- audio-s/s；
- req/s；
- 生成音频总时长。

TTS 输出长度会随模型采样变化。只看 req/s 可能把“生成得更短”误判成“计算更快”，因此性能结论应优先结合 audio-s/s 和 RTF。
