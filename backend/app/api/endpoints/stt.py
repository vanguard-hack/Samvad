"""Speech to text: short recordings (REST) and live audio (WebSocket)."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket, status

from app.api.dependencies import current_user
from app.services import speech_service, stream_service

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 30 s of any sensible codec is far below this


@router.post("/stt")
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
    return await speech_service.transcribe(
        filename=audio.filename or "audio.webm",
        data=data,
        content_type=audio.content_type or "audio/webm",
        mode=mode,
        language=language,
    )


@router.websocket("/stt/stream")
async def stt_stream(ws: WebSocket) -> None:
    """Live 16 kHz PCM → partial + final transcripts. Protocol: see stream_service.run_live_transcription."""
    await stream_service.run_live_transcription(ws)
