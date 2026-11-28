"""Only signed-in doctors may use the speech APIs (they spend the Sarvam quota).

The browser sends its Supabase access token; we ask Supabase Auth who it
belongs to. Results are cached briefly so each audio request doesn't add a
round trip. No secret key is needed for this check.
"""

import hashlib
import time

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

_CACHE_SECONDS = 60
_cache: dict[str, tuple[float, str]] = {}
_emails: dict[str, str] = {}  # token hash -> the user's email, filled by verify_token
_client = httpx.AsyncClient(timeout=10)


async def verify_token(token: str) -> str:
    """Return the Supabase user id for a valid access token, else raise 401."""
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    s = get_settings()
    if not s.supabase_url or not s.supabase_publishable_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Auth is not configured on the server")
    try:
        r = await _client.get(
            f"{s.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": s.supabase_publishable_key},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach the auth service") from exc
    if r.status_code != 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, sign in again")
    user = r.json()
    user_id = user.get("id", "")
    if len(_cache) > 1000:
        _cache.clear()
        _emails.clear()
    _cache[key] = (now + _CACHE_SECONDS, user_id)
    _emails[key] = user.get("email") or ""
    return user_id


async def user_email(token: str) -> str:
    """The signed-in user's email ("" if their account has none); 401 for an invalid token."""
    await verify_token(token)
    return _emails.get(hashlib.sha256(token.encode()).hexdigest(), "")
