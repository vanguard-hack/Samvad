"""Samvad API: a thin, authenticated proxy to Sarvam AI speech and translation.

The Sarvam key never leaves the server. Audio and text pass straight through:
nothing is stored or logged here (Critical Rule 3), and Sarvam's workspace is
set to 0-day retention.

Endpoints (all under /api, all need a Supabase access token):
  POST /api/stt          short recording (≤ 30 s) → transcript
  WS   /api/stt/stream   live 16 kHz PCM audio → partial + final transcripts
  POST /api/tts          text → spoken WAV in Samvad's female voice
  POST /api/translate    text → text between Indian languages
  POST /api/intake/*     voice-guided New patient questions (see intake.py)
  POST /api/assistant    Ctrl+Space voice assistant (Claude on Bedrock, see assistant.py)
  GET  /api/health       liveness (no auth)
"""

import asyncio
import base64
import contextlib
import json
import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sarvamai import AsyncSarvamAI, RealtimeAudioInput, RealtimeEnd
from sarvamai.core.api_error import ApiError

from . import languages
from .auth import current_user, verify_token
from .config import get_settings

log = logging.getLogger("samvad")
settings = get_settings()

app = FastAPI(title="Samvad API", docs_url=None, redoc_url=None, openapi_url=None)


def _include_routers() -> None:
    from .assistant import router as assistant_router
    from .intake import router as intake_router

    app.include_router(intake_router)
    app.include_router(assistant_router)
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

_streams = asyncio.Semaphore(settings.max_streams)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 30 s of any sensible codec is far below this


def sarvam() -> AsyncSarvamAI:
    if not settings.sarvam_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Speech service is not configured")
    return AsyncSarvamAI(api_subscription_key=settings.sarvam_api_key, timeout=30)


def upstream_error(exc: ApiError) -> HTTPException:
    """Pass a safe, generic message back; never echo upstream bodies (they may contain text)."""
    code = exc.status_code or 502
    if code == 429:
        return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Speech service is busy, try again in a moment")
    if code in (401, 403):
        log.error("Sarvam rejected the API key")
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Speech service is not configured")
    if code == 400:
        return HTTPException(status.HTTP_400_BAD_REQUEST, "The speech service could not process this request")
    log.warning("Sarvam error %s", code)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service error")


_include_routers()


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "speech": bool(settings.sarvam_api_key)}


# ── Speech to text (short recordings) ────────────────────────────────────────
@app.post("/api/stt")
async def stt(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
    mode: str = Form("transcribe"),
    _user: str = Depends(current_user),
) -> dict:
    if mode not in ("transcribe", "codemix", "verbatim"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported mode")
    data = await audio.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty recording")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Recording too large")
    try:
        r = await sarvam().speech_to_text.transcribe(
            file=(audio.filename or "audio.webm", data, audio.content_type or "audio/webm"),
            model=settings.stt_model,
            mode=mode,
            language_code=languages.stt_rest_code(language),
        )
    except ApiError as exc:
        raise upstream_error(exc) from None
    return {
        "transcript": r.transcript,
        "language": r.language_code,
        # Confidence of the *language guess* only; Sarvam gives no transcript confidence.
        "languageProbability": r.language_probability,
    }


# ── Text to speech ───────────────────────────────────────────────────────────
class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    language: str
    pace: float = Field(default=1.0, ge=0.5, le=2.0)


@app.post("/api/tts")
async def tts(body: TtsIn, _user: str = Depends(current_user)) -> Response:
    code = languages.TTS.get(body.language)
    if not code:
        # Never fake a voice for a language Sarvam can't speak.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No voice for this language")
    try:
        r = await sarvam().text_to_speech.convert(
            text=body.text,
            language_code=code,
            model=settings.tts_model,
            speaker=settings.tts_speaker,
            pace=body.pace,
            speech_sample_rate=22050,
        )
    except ApiError as exc:
        raise upstream_error(exc) from None
    if not r.audios:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service returned no audio")
    return Response(base64.b64decode(r.audios[0]), media_type="audio/wav", headers={"Cache-Control": "no-store"})


# ── Translation ──────────────────────────────────────────────────────────────
class TranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source: str
    target: str


@app.post("/api/translate")
async def translate(body: TranslateIn, _user: str = Depends(current_user)) -> dict:
    src, dst = languages.TRANSLATE.get(body.source), languages.TRANSLATE.get(body.target)
    if not src or not dst:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported language")
    try:
        r = await sarvam().text.translate(
            input=body.text, source_language_code=src, target_language_code=dst, model="sarvam-translate:v1"
        )
    except ApiError as exc:
        raise upstream_error(exc) from None
    return {"text": r.translated_text}


# ── Live speech to text ──────────────────────────────────────────────────────
@app.websocket("/api/stt/stream")
async def stt_stream(ws: WebSocket) -> None:
    """Browser protocol:
    1. client → {"type": "start", "token": <supabase access token>, "language": "auto"|"hi"|…}
       (the token goes in a message, never in the URL, so it can't land in logs)
    2. server → {"type": "ready"}
    3. client → binary frames: 16 kHz mono 16-bit little-endian PCM, ~100 ms each
       server → {"type": "partial"|"final", "text", "language"} and {"type": "speech_start"|"speech_end"}
    4. client → {"type": "end"}; server flushes the last transcript, then {"type": "closed"}
    Errors: {"type": "error", "message"} then close.
    """
    await ws.accept()

    async def fail(message: str, code: int = 1011) -> None:
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "error", "message": message})
            await ws.close(code)

    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
        if first.get("type") != "start":
            raise ValueError
        await verify_token(str(first.get("token", "")))
    except HTTPException as exc:
        return await fail(str(exc.detail), 4401)
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect, KeyError, TypeError):
        return await fail("Bad start message", 4400)

    if not settings.sarvam_api_key:
        return await fail("Speech service is not configured")
    if _streams.locked():
        return await fail("Too many live sessions, try again shortly", 4429)

    mode = first.get("mode") if first.get("mode") in ("transcribe", "codemix") else "transcribe"
    async with _streams:
        try:
            async with sarvam().speech_to_text_realtime_streaming.connect(
                language_code=languages.stt_stream_code(first.get("language")),
                model=settings.stt_model,
                mode=mode,
                stream_type="fast",
                encoding="linear16",
                sample_rate="16000",
            ) as upstream:
                await ws.send_json({"type": "ready"})

                async def pump_audio() -> None:
                    while True:
                        msg = await ws.receive()
                        if msg["type"] == "websocket.disconnect":
                            raise WebSocketDisconnect
                        if msg.get("bytes"):
                            chunk = msg["bytes"]
                            # Sarvam rejects frames over 500 ms (16 000 bytes); split defensively.
                            for i in range(0, len(chunk), 16000):
                                await upstream.send_realtime_audio_input(
                                    RealtimeAudioInput(audio=base64.b64encode(chunk[i : i + 16000]).decode())
                                )
                        elif msg.get("text") and json.loads(msg["text"]).get("type") == "end":
                            await upstream.send_realtime_end(RealtimeEnd())
                            return

                async def pump_results() -> None:
                    async for m in upstream:
                        event = getattr(m, "event", None)
                        if event in ("transcript.partial", "transcript.final"):
                            await ws.send_json(
                                {"type": event.split(".")[1], "text": m.text, "language": getattr(m, "language", None)}
                            )
                        elif event == "vad.speech_start":
                            await ws.send_json({"type": "speech_start"})
                        elif event == "vad.speech_end":
                            await ws.send_json({"type": "speech_end"})
                        elif event == "error":
                            log.warning("Sarvam stream error %s", m.code)
                            if m.is_fatal:
                                await ws.send_json({"type": "error", "message": "Speech service error"})
                                return
                        elif event == "session.end":
                            return

                audio_task = asyncio.create_task(pump_audio())
                results_task = asyncio.create_task(pump_results())
                done, pending = await asyncio.wait({audio_task, results_task}, return_when=asyncio.FIRST_COMPLETED)
                if audio_task in done and audio_task.exception() is None:
                    # Client said "end": wait (briefly) for Sarvam's final transcript.
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(results_task, timeout=5)
                for task in (audio_task, results_task):
                    task.cancel()
                    with contextlib.suppress(BaseException):
                        await task
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "closed"})
                await ws.close()
        except WebSocketDisconnect:
            return
        except Exception:  # noqa: BLE001 — upstream connect failures, bad key, rate limit
            log.exception("Live transcription failed")
            await fail("Speech service unavailable")
