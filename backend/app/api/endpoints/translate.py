from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import current_user
from app.core import languages
from app.schemas.speech import TranslateIn
from app.services import speech_service

router = APIRouter()


@router.post("/translate")
async def translate(body: TranslateIn, _user: str = Depends(current_user)) -> dict:
    src, dst = languages.TRANSLATE.get(body.source), languages.TRANSLATE.get(body.target)
    if not src or not dst:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported language")
    return {"text": await speech_service.translate(text=body.text, source=src, target=dst)}
