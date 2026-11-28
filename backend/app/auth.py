"""Only signed-in doctors may use the speech APIs (they spend the Sarvam quota).

The browser sends its Supabase access token; we ask Supabase Auth who it
belongs to. Results are cached briefly so each audio request doesn't add a
round trip. No secret key is needed for this check.
"""

import hashlib
import time

import httpx
from fastapi import Header, HTTPException, status

from .config import get_settings

_CACHE_SECONDS = 60
_cache: dict[str, tuple[float, str]] = {}
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
    user_id = r.json().get("id", "")
    if len(_cache) > 1000:
        _cache.clear()
    _cache[key] = (now + _CACHE_SECONDS, user_id)
    return user_id


async def current_user(authorization: str = Header(default="")) -> str:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    return await verify_token(token.strip())


async def current_session(authorization: str = Header(default="")) -> tuple[str, str]:
    """(user id, access token) — for calls that act on Supabase as the doctor (RLS applies)."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    token = token.strip()
    return await verify_token(token), token
