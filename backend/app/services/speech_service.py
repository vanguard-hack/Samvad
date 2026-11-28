"""Sarvam speech-to-text, text-to-speech and translation (audio/text pass through, never stored or logged)."""

import base64

from fastapi import HTTPException, status
from sarvamai.core.api_error import ApiError

from app.core import languages
from app.core.sarvam import sarvam, settings, upstream_error


async def transcribe(*, filename: str, data: bytes, content_type: str, mode: str, language: str) -> dict:
    try:
        r = await sarvam().speech_to_text.transcribe(
            file=(filename, data, content_type),
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


async def synthesize(*, text: str, language_code: str, pace: float) -> bytes:
    """Spoken WAV bytes in Samvad's female voice."""
    try:
        r = await sarvam().text_to_speech.convert(
            text=text,
            language_code=language_code,
            model=settings.tts_model,
            speaker=settings.tts_speaker,
            pace=pace,
            speech_sample_rate=22050,
        )
    except ApiError as exc:
        raise upstream_error(exc) from None
    if not r.audios:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service returned no audio")
    return base64.b64decode(r.audios[0])


async def translate(*, text: str, source: str, target: str) -> str:
    """`source` / `target` are Sarvam language codes (see core/languages.py)."""
    try:
        r = await sarvam().text.translate(
            input=text, source_language_code=source, target_language_code=target, model="sarvam-translate:v1"
        )
    except ApiError as exc:
        raise upstream_error(exc) from None
    return r.translated_text
