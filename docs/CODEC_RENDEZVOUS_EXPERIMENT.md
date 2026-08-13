# Qwen3-TTS-Pro codec rendezvous scheduler

Status: experimental and disabled in the active production profile. The
normalized throughput gain was too small to justify enabling it by default.

## Goal

Qwen3-TTS is a two-stage pipeline: the autoregressive Talker produces codec
chunks and Code2Wav turns them into PCM. Under concurrent streaming load, the
chunks reach Stage 1 at slightly different times. The ordinary scheduler often
runs Code2Wav with one request even when shape-compatible peers are less than a
millisecond away.

The codec rendezvous scheduler is an opt-in Stage 1 policy that exchanges a
small, bounded queueing window for a larger effective decoder batch. It is an
engineering optimization; model weights and generated codec tokens are not
changed.

## Algorithm

1. Read the ready Stage 1 chunks and derive the effective Code2Wav frame shape.
   The classifier handles both tensor payloads and the production flat
   `prompt_token_ids` path, including separately cached reference context.
2. Immediately release single-request traffic, first chunks, terminal chunks,
   malformed/unclassified chunks, and full shape buckets.
3. Park only undersized steady-state buckets. Release when a compatible bucket
   reaches the target size or its load-adaptive deadline expires.
4. Wait on a receive-thread condition variable. An arrival epoch prevents a
   notify-before-wait race; no fixed-interval polling is used.
5. Release only the full compatible bucket. An unrelated partial bucket is not
   pulled into the same decoder turn.

The last tested throughput candidate used target batch 2 and a 0.10–0.50 ms window.
An optional first-packet protection mode disables rendezvous whenever a live
peer is still waiting for its first upstream chunk.

## Configuration

The keys live under `connectors.<name>.extra`:

| Key | Deployed value | Meaning |
| --- | ---: | --- |
| `codec_rendezvous_enabled` | `false` | Enable the Stage 1 policy; currently rolled back. |
| `codec_rendezvous_target_batch_size` | `2` | Release a compatible bucket at this size. |
| `codec_rendezvous_min_wait_ms` | `0.10` | Low-load wait bound. |
| `codec_rendezvous_max_wait_ms` | `0.50` | Saturated-load wait bound. |
| `codec_rendezvous_protect_first_packet` | `false` | Bypass all waits while a peer awaits its first chunk. |
| `codec_num_quantizers` | `16` | Codec tokens per frame; defaults to 16. |
| `codec_rendezvous_stats_log_every` | `100` | Log release statistics every N chunks. |

Statistics report release cause, mean/max wait, target/deadline hits, SLO
bypasses, and the observed compatible-batch histogram. Code2Wav separately
reports actual decoder group sizes when `QWEN3_TTS_CODE2WAV_BATCH_STATS=1`.

## Safety properties

- The feature is scoped to a generation worker that receives chunks, so the
  Talker stage is unaffected.
- Single-request traffic never waits.
- First and terminal chunks never wait.
- The deadline is bounded; no chunk depends on a future peer for progress.
- Consumed request IDs are committed back to the connector ready set, while
  parked IDs remain ready for the next scheduler turn.
- The feature is reversible with one YAML switch.

The adapter, scheduler, and Code2Wav suites pass 172 tests. Non-streaming WAV
and streaming raw PCM were also exercised after the final restart.

## Current evidence and limits

The isolated c8 A/B is recorded in
[`benchmarks/codec-rendezvous-ab/REPORT.md`](../benchmarks/codec-rendezvous-ab/REPORT.md). It shows lower
wall-clock E2E latency and higher request throughput, but only a +0.44% gain
after normalizing by generated audio duration. The benchmark remains a single
A100 run on a shared GPU, and even `temperature=0` did not make generated audio
length perfectly invariant. Repeat runs and a dedicated GPU are required
before presenting the result as a statistically established model speedup.

Cross-shape padding was not enabled for short streaming chunks. The decoder's
safe variable-length path is intended for longer chunked inputs; padding short
chunks through the ordinary convolutional decode path risks boundary audio
artifacts.

## Rollback

Set the following value and restart the Qwen3-TTS service:

```yaml
codec_rendezvous_enabled: false
```

No model cache or weight change is required.
