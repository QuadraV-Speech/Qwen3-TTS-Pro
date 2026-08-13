# Changelog

## 0.1.0-preview — 2026-08-13

- Clarified the tested runtime as vLLM `0.26.0+cu129` plus vLLM-Omni `v0.26.0` (`a4ea67a`).
- Added a vLLM-Omni 0.26.0 patch for Qwen3-TTS model-level incremental text input.
- Added the `input.plan` / `input.tokens` WebSocket protocol and Talker KV-continuation path.
- Added streamed PCM playback and same-origin HTTP/WebSocket proxy.
- Added the dark Qwen3 TTS Pro WebUI and full dual-track autoregression view.
- Added a real-service animated WebUI demo and redesigned the project landing README.
- Added the concurrent A100 deployment profile and reproducible benchmark reports.
- Preserved Codec Rendezvous as a disabled experiment after a +0.44% normalized-throughput result.
