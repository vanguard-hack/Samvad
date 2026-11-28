"""Sarvam AI client factory and upstream error mapping, shared by every service.

The Sarvam key never leaves the server. Upstream error bodies are never echoed
back (they may contain patient text).
"""

import logging

from fastapi import HTTPException, status
from sarvamai import AsyncSarvamAI
from sarvamai.core.api_error import ApiError

from app.core.config import get_settings

log = logging.getLogger("samvad")
settings = get_settings()


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
