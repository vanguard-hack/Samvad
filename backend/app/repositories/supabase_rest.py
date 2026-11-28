"""One Supabase table over PostgREST, called as the signed-in doctor.

Requests carry the doctor's own access token, so row-level security applies
(no service-role key is used). PostgREST errors become HTTPExceptions with the
right status and a clear message.
"""

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

log = logging.getLogger("samvad.db")

_http = httpx.AsyncClient(timeout=15)


class SupabaseTable:
    """`table`: the table name; `label`: what its rows are called in error messages."""

    table = ""
    label = "records"

    def __init__(self, token: str, http: httpx.AsyncClient = _http):
        s = get_settings()
        self.url = f"{s.supabase_url}/rest/v1/{self.table}"
        self.headers = {"apikey": s.supabase_publishable_key, "Authorization": f"Bearer {token}"}
        self.http = http

    async def _request(self, method: str, *, params: dict, json: Any = None, prefer: str = "return=representation") -> Any:
        try:
            r = await self.http.request(method, self.url, params=params, json=json, headers={**self.headers, "Prefer": prefer})
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach the database") from exc
        if r.status_code >= 400:
            raise _db_error(r, self.label)
        return r.json() if r.content else None


def _db_error(r: httpx.Response, label: str) -> HTTPException:
    """Map a PostgREST error (https://docs.postgrest.org/en/stable/references/errors.html)."""
    try:
        body = r.json()
    except ValueError:
        body = {}
    code, message = body.get("code", ""), body.get("message", "")
    log.warning("Supabase error %d %s: %s", r.status_code, code, message)

    if r.status_code == 401:
        return HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, sign in again")
    if code == "42501" or r.status_code == 403:
        return HTTPException(status.HTTP_403_FORBIDDEN, f"Not allowed to change these {label}")
    if code == "23505" or r.status_code == 409:
        return HTTPException(status.HTTP_409_CONFLICT, f"These {label} already exist")
    if code in ("23514", "22P02", "22007", "22008"):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Invalid {label}: {message}")
    if code in ("PGRST205", "42P01"):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"The {label} table is missing, apply the Supabase migrations")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Database error while reading or saving {label}")
