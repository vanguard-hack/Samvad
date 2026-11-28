from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.api.dependencies import current_user
from app.core import languages
from app.schemas.speech import TtsIn
from app.services import speech_service

router = APIRouter()


@router.post("/tts")
async def tts(body: TtsIn, _user: str = Depends(current_user)) -> Response:
    code = languages.TTS.get(body.language)
    if not code:
        # Never fake a voice for a language Sarvam can't speak.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No voice for this language")
    audio = await speech_service.synthesize(text=body.text, language_code=code, pace=body.pace)
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
