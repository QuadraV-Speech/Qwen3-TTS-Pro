# A100 codec rendezvous A/B

Status: the candidate was rolled back after evaluation. The active service uses
the disabled baseline because the normalized audio-throughput gain was only
0.44% in this run.

## Setup

- Model: `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- Runtime: vLLM/vLLM-Omni 0.26.0
- Device: one A100-SXM4-80GB, shared with an unrelated process using about
  13.1 GiB
- Dataset: Seed-TTS text smoke set, oversampled to the requested count
- Endpoint: OpenAI-compatible streaming `/v1/audio/speech`
- Sampling control: benchmark request `temperature=0`
- Warm-up: 2 requests before every measured run
- A/B variable: `codec_rendezvous_enabled`; all other deployment settings were
  held constant

The final candidate uses target batch 2, an event-driven 0.10–0.50 ms window,
and first-packet protection disabled. First and terminal chunks still bypass
unconditionally.

## Isolated c8 result

| Metric | Disabled | Final candidate | Delta |
| --- | ---: | ---: | ---: |
| Successful requests | 80/80 | 80/80 | — |
| Benchmark duration | 14.238 s | 13.674 s | -3.96% |
| Request throughput | 5.619 req/s | 5.851 req/s | +4.13% |
| Audio throughput | 30.329 audio-s/s | 30.464 audio-s/s | +0.44% |
| Mean E2E | 1356.0 ms | 1310.0 ms | -3.39% |
| Median E2E | 1348.1 ms | 1301.0 ms | -3.49% |
| P99 E2E | 1917.0 ms | 1790.7 ms | -6.59% |
| Mean audio RTF | 0.2516 | 0.2521 | +0.22% |
| P99 audio RTF | 0.2706 | 0.2695 | -0.41% |
| Mean TTFP | 108.54 ms | 108.06 ms | -0.44% |
| Median TTFP | 102.56 ms | 103.82 ms | +1.23% |
| P99 TTFP | 161.72 ms | 164.66 ms | +1.82% |

The candidate generated 416.56 audio seconds versus 431.84 seconds in the
disabled run, despite `temperature=0`. Request-throughput and raw E2E deltas
therefore include output-length variation. Audio throughput and RTF are the
more conservative efficiency indicators; the normalized gain is modest and
should be confirmed with repetitions on an exclusive GPU.

## Final profile sanity runs

| Concurrency | Requests | Req/s | Audio-s/s | Median TTFP | P99 TTFP | Median RTF |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 20/20 | 1.251 | 6.494 | 47.43 ms | 49.36 ms | 0.1539 |
| 8 | 80/80 | 5.851 | 30.464 | 103.82 ms | 164.66 ms | 0.2550 |
| 16 | 160/160 | 7.827 | 42.165 | 161.36 ms | 264.26 ms | 0.3753 |

The c16 row is a stability/result snapshot, not an isolated enabled/disabled
A/B. All measured requests completed successfully.

## Tuning history

- An 8 ms, target-8 polling prototype raised decoder batch size but regressed
  RTF substantially; it was rejected.
- A 1 ms event-driven prototype improved c8 throughput but produced an
  unacceptable TTFP p99 outlier; it was rejected.
- Strict admission-time SLO protection bypassed too frequently under sustained
  saturation and removed the throughput benefit; it remains an optional mode.
- The deployed 0.5 ms event-driven profile is the best low-risk point measured
  in this session.

Raw JSON files in this directory are the source of the tables. In particular:

- `disabled_c1_t0.json`, `disabled_c8_t0.json`
- `throughput_c1_t0.json`, `throughput_c8_t0.json`, `throughput_c16_t0.json`
- Rejected candidates: `enabled_c8_t0.json`, `guarded_c8_t0.json`
