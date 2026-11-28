"""Ctrl+Space voice assistant (Claude on Bedrock; logic in services/assistant_service.py)."""

from fastapi import APIRouter, Depends

from app.api.dependencies import current_session
from app.schemas.assistant import AssistantIn
from app.services import assistant_service

router = APIRouter()


@router.post("/assistant")
async def assistant(body: AssistantIn, session: tuple[str, str] = Depends(current_session)) -> dict:
    _user, token = session
    return await assistant_service.run_assistant(body, token)
