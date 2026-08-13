#!/usr/bin/env python3
"""Standalone dark Web UI and reverse proxy for Qwen3-TTS."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from contextlib import suppress
from pathlib import Path
from typing import Any

import httpx
import uvicorn
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.websockets import WebSocketState


LOGGER = logging.getLogger("qwen3_tts_webui")
WEB_DIR = Path(__file__).resolve().parent / "webui"
DEFAULT_API_BASE = "http://127.0.0.1:8091"
ALLOWED_FORMATS = {"wav", "mp3", "flac", "pcm", "aac", "opus"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Qwen3-TTS dark Web UI")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    return parser.parse_args()


def create_app(api_base: str) -> FastAPI:
    api_base = api_base.rstrip("/")
    upstream_ws_base = api_base.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
    app = FastAPI(title="Qwen3-TTS Studio", docs_url=None, redoc_url=None)
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/api/health")
    async def health() -> JSONResponse:
        try:
            async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
                response = await client.get(f"{api_base}/health")
            return JSONResponse(
                {
                    "ok": response.is_success,
                    "upstream": api_base,
                    "status_code": response.status_code,
                },
                status_code=200 if response.is_success else 503,
            )
        except httpx.HTTPError as exc:
            return JSONResponse(
                {"ok": False, "upstream": api_base, "error": str(exc)},
                status_code=503,
            )

    @app.get("/api/voices")
    async def voices() -> Response:
        try:
            async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
                response = await client.get(
                    f"{api_base}/v1/audio/voices",
                    headers={"Authorization": "Bearer EMPTY"},
                )
            if not response.is_success:
                return upstream_error(response)
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type="application/json",
            )
        except httpx.HTTPError as exc:
            LOGGER.exception("Failed to load voices")
            return JSONResponse({"error": str(exc)}, status_code=502)

    @app.post("/api/speech")
    async def speech(request: Request) -> Response:
        try:
            incoming: dict[str, Any] = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "请求内容不是有效的 JSON。"}, status_code=400)

        text = str(incoming.get("input", "")).strip()
        voice = str(incoming.get("voice", "")).strip()
        response_format = str(incoming.get("response_format", "pcm")).lower()
        stream = bool(incoming.get("stream", True))

        if not text:
            return JSONResponse({"error": "请输入要合成的文本。"}, status_code=400)
        if len(text) > 5000:
            return JSONResponse({"error": "单次文本不能超过 5000 个字符。"}, status_code=400)
        if not voice:
            return JSONResponse({"error": "请选择音色。"}, status_code=400)
        if response_format not in ALLOWED_FORMATS:
            return JSONResponse({"error": "不支持的音频格式。"}, status_code=400)

        payload: dict[str, Any] = {
            "input": text,
            "voice": voice,
            "language": incoming.get("language") or "Auto",
            "task_type": "CustomVoice",
            "response_format": "pcm" if stream else response_format,
            "stream": stream,
        }
        # vLLM-Omni 0.26 defaults streamed speech to SSE, where PCM is wrapped
        # in JSON and base64 encoded. The browser player consumes raw PCM16, so
        # explicitly request the binary audio stream.
        if stream:
            payload["stream_format"] = "audio"
        instructions = str(incoming.get("instructions", "")).strip()
        if instructions:
            payload["instructions"] = instructions
        if not stream:
            try:
                payload["speed"] = min(2.0, max(0.5, float(incoming.get("speed", 1.0))))
            except (TypeError, ValueError):
                payload["speed"] = 1.0

        LOGGER.info(
            "Synthesis request: voice=%s language=%s stream=%s chars=%d",
            voice,
            payload["language"],
            stream,
            len(text),
        )

        client = httpx.AsyncClient(timeout=None, trust_env=False)
        try:
            upstream_request = client.build_request(
                "POST",
                f"{api_base}/v1/audio/speech",
                json=payload,
                headers={"Authorization": "Bearer EMPTY"},
            )
            upstream = await client.send(upstream_request, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            LOGGER.exception("Failed to connect to vLLM")
            return JSONResponse({"error": str(exc)}, status_code=502)

        if not upstream.is_success:
            body = await upstream.aread()
            await upstream.aclose()
            await client.aclose()
            message = decode_upstream_error(body)
            LOGGER.error("vLLM returned %s: %s", upstream.status_code, message)
            return JSONResponse({"error": message}, status_code=upstream.status_code)

        async def close_upstream() -> None:
            await upstream.aclose()
            await client.aclose()

        media_type = upstream.headers.get("content-type") or media_type_for(response_format, stream)
        headers = {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        }
        return StreamingResponse(
            upstream.aiter_raw(),
            status_code=upstream.status_code,
            media_type=media_type,
            headers=headers,
            background=BackgroundTask(close_upstream),
        )

    @app.websocket("/api/speech/stream")
    async def speech_stream(websocket: WebSocket) -> None:
        """Same-origin proxy for the native model-level text stream.

        Keeping the browser on the UI origin avoids exposing the internal API
        address and works when the page is opened from another machine.
        Text control frames and binary PCM frames are forwarded unchanged.
        """
        await websocket.accept()
        upstream_url = f"{upstream_ws_base}/v1/audio/speech/stream"
        try:
            async with websockets.connect(
                upstream_url,
                max_size=None,
                ping_interval=20,
                ping_timeout=60,
                proxy=None,
            ) as upstream:

                async def browser_to_model() -> None:
                    while True:
                        message = await websocket.receive()
                        message_type = message.get("type")
                        if message_type == "websocket.disconnect":
                            return
                        if message.get("text") is not None:
                            await upstream.send(message["text"])
                        elif message.get("bytes") is not None:
                            await upstream.send(message["bytes"])

                async def model_to_browser() -> None:
                    async for message in upstream:
                        if isinstance(message, str):
                            await websocket.send_text(message)
                        else:
                            await websocket.send_bytes(bytes(message))

                tasks = {
                    asyncio.create_task(browser_to_model()),
                    asyncio.create_task(model_to_browser()),
                }
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                for task in pending:
                    with suppress(asyncio.CancelledError):
                        await task
                for task in done:
                    task.result()
        except WebSocketDisconnect:
            return
        except Exception as exc:
            LOGGER.exception("Native streaming WebSocket proxy failed")
            if websocket.client_state == WebSocketState.CONNECTED:
                with suppress(Exception):
                    await websocket.send_json({"type": "error", "message": str(exc)})
                with suppress(Exception):
                    await websocket.close(code=1011)

    return app


def decode_upstream_error(body: bytes) -> str:
    if not body:
        return "vLLM 服务返回了空错误响应。"
    try:
        data = json.loads(body)
        if isinstance(data, dict):
            error = data.get("error") or data.get("detail") or data.get("message")
            if isinstance(error, dict):
                return str(error.get("message") or error)
            if error:
                return str(error)
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return body.decode("utf-8", errors="replace")[:1000]


def upstream_error(response: httpx.Response) -> JSONResponse:
    return JSONResponse(
        {"error": decode_upstream_error(response.content)},
        status_code=response.status_code,
    )


def media_type_for(response_format: str, stream: bool) -> str:
    if stream or response_format == "pcm":
        return "application/octet-stream"
    return {
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "flac": "audio/flac",
        "aac": "audio/aac",
        "opus": "audio/ogg",
    }.get(response_format, "application/octet-stream")


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    if not (WEB_DIR / "index.html").is_file():
        raise SystemExit(f"Web assets are missing: {WEB_DIR}")
    LOGGER.info("Web UI connects to vLLM at %s", args.api_base)
    uvicorn.run(create_app(args.api_base), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
