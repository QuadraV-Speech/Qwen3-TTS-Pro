#!/usr/bin/env python3
"""End-to-end check for Qwen3-TTS token-native model input streaming."""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import websockets


MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8091/v1/audio/speech/stream")
    parser.add_argument("--text", default="你好，这是模型级逐字流式测试。")
    parser.add_argument("--token-batch-delay-ms", type=float, default=25.0)
    parser.add_argument("--initial-token-lookahead", type=int, default=24)
    parser.add_argument("--token-batch-size", type=int, default=16)
    parser.add_argument("--voice", default="vivian")
    return parser.parse_args()


async def run(args: argparse.Namespace) -> None:
    if not args.text:
        raise SystemExit("--text must not be empty")

    started = time.perf_counter()
    first_audio_ms: float | None = None
    input_done_ms: float | None = None
    pcm_bytes = 0
    errors: list[dict] = []
    audio_done: dict = {}

    async with websockets.connect(args.url, max_size=None, ping_timeout=60, proxy=None) as websocket:
        await websocket.send(
            json.dumps(
                {
                    "type": "session.config",
                    "model": MODEL,
                    "voice": args.voice,
                    "language": "Chinese",
                    "response_format": "pcm",
                    "stream_audio": True,
                    "model_streaming_input": True,
                    "non_streaming_mode": False,
                    "initial_codec_chunk_frames": 1,
                },
                ensure_ascii=False,
            )
        )
        await websocket.send(json.dumps({"type": "input.plan", "text": args.text}, ensure_ascii=False))

        plan_event = json.loads(await asyncio.wait_for(websocket.recv(), timeout=30))
        if plan_event.get("type") != "input.plan.ready":
            raise RuntimeError(f"unexpected token-plan response: {plan_event}")
        token_ids = plan_event["token_ids"]
        initial_limit = len(token_ids) - 1 if len(token_ids) > 1 else len(token_ids)
        initial_count = min(max(1, args.initial_token_lookahead), initial_limit)
        await websocket.send(
            json.dumps({"type": "input.tokens", "token_ids": token_ids[:initial_count]})
        )
        input_was_closed = initial_count == len(token_ids)
        if input_was_closed:
            input_done_ms = (time.perf_counter() - started) * 1000
            await websocket.send(json.dumps({"type": "input.done"}))

        while first_audio_ms is None:
            message = await asyncio.wait_for(websocket.recv(), timeout=30)
            if isinstance(message, bytes):
                pcm_bytes += len(message)
                first_audio_ms = (time.perf_counter() - started) * 1000
            else:
                event = json.loads(message)
                if event.get("type") == "error":
                    raise RuntimeError(event.get("message", "streaming request failed"))

        cursor = initial_count
        is_first_live_batch = True
        while cursor < len(token_ids):
            if not is_first_live_batch:
                await asyncio.sleep(args.token_batch_delay_ms / 1000)
            next_cursor = min(cursor + max(1, args.token_batch_size), len(token_ids))
            await websocket.send(
                json.dumps({"type": "input.tokens", "token_ids": token_ids[cursor:next_cursor]})
            )
            cursor = next_cursor
            is_first_live_batch = False
        if not input_was_closed:
            input_done_ms = (time.perf_counter() - started) * 1000
            await websocket.send(json.dumps({"type": "input.done"}))

        while True:
            message = await asyncio.wait_for(websocket.recv(), timeout=40)
            if isinstance(message, bytes):
                pcm_bytes += len(message)
                continue
            event = json.loads(message)
            if event.get("type") == "error":
                errors.append(event)
            elif event.get("type") == "audio.done":
                audio_done = event
            elif event.get("type") == "session.done":
                break

    completed_ms = (time.perf_counter() - started) * 1000
    result = {
        "characters": len(args.text),
        "text_tokens": len(token_ids),
        "first_audio_ms": round(first_audio_ms, 1),
        "input_done_ms": round(input_done_ms, 1),
        "audio_before_input_done": first_audio_ms < input_done_ms,
        "completed_ms": round(completed_ms, 1),
        "pcm_bytes": pcm_bytes,
        "audio_seconds": round(pcm_bytes / 48000, 3),
        "audio_done": audio_done,
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if (
        (len(token_ids) > 1 and not result["audio_before_input_done"])
        or not pcm_bytes
        or errors
        or audio_done.get("error") is not False
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
