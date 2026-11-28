"""Voice intake for the New patient form (logic and safety notes: services/intake_service.py)."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import current_user
from app.core import languages
from app.schemas.intake import ParseIn, PromptIn
from app.services import intake_service

router = APIRouter()


@router.post("/prompt")
async def prompt(body: PromptIn, _user: str = Depends(current_user)) -> dict:
    """The question as text (patient's language + English) and spoken WAV (base64)."""
    if body.key not in intake_service.PROMPTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown question")
    code = languages.TTS.get(body.language)
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No voice for this language")
    return await intake_service.build_prompt(key=body.key, language=body.language, tts_code=code, value=body.value)


@router.post("/parse")
async def parse_answer(body: ParseIn, _user: str = Depends(current_user)) -> dict:
    """Turns the patient's spoken answer into a form value."""
    if body.field not in intake_service.PROMPTS or body.language not in languages.TRANSLATE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad request")
    return await intake_service.interpret_answer(field=body.field, language=body.language, text=body.text)
