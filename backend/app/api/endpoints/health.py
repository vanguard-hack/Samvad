from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    # Liveness, no sign-in needed.
    return {"ok": True, "speech": bool(get_settings().sarvam_api_key)}
