"""Shared FastAPI dependencies."""

from fastapi import Depends, Header, HTTPException, status

from app.core.security import user_email, verify_token


async def current_user(authorization: str = Header(default="")) -> str:
    """Supabase user id from the `Authorization: Bearer <token>` header, else 401."""
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


async def current_email(session: tuple[str, str] = Depends(current_session)) -> str:
    """The signed-in doctor's email, from Supabase Auth ("" if none)."""
    return await user_email(session[1])
