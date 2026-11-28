"""Shared FastAPI dependencies."""

from fastapi import Header, HTTPException, status

from app.core.security import verify_token


async def current_user(authorization: str = Header(default="")) -> str:
    """Supabase user id from the `Authorization: Bearer <token>` header, else 401."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    return await verify_token(token.strip())
