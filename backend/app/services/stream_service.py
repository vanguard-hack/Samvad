"""Live speech to text: relays browser PCM audio to Sarvam's realtime socket."""

import asyncio
import base64
import contextlib
import json
import logging

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from sarvamai import RealtimeAudioInput, RealtimeEnd

from app.core import languages
from app.core.sarvam import sarvam, settings
from app.core.security import verify_token

log = logging.getLogger("samvad")

# Pay-as-you-go allows 20 concurrent streaming sockets per account; stay under it.
_streams = asyncio.Semaphore(settings.max_streams)


async def run_live_transcription(ws: WebSocket) -> None:
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
