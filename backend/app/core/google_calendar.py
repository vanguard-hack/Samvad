"""Google Calendar API v3, called as a service account.

Why a service account: the API runs unattended on Railway, so there is no
browser to complete a user OAuth flow, and a public repo must hold no tokens.
The service account's JSON key lives only in the GOOGLE_SERVICE_ACCOUNT_JSON
secret; the clinic calendar is shared with the service account's email
("Make changes to events"). Scope: calendar.events, the narrowest one that
covers events.list and events.insert.

google-auth signs the token request; the REST calls go through httpx so they
stay async. Every Google failure becomes an HTTPException with a clear message.

Reference: https://developers.google.com/workspace/calendar/api/v3/reference/events
"""

import asyncio
import base64
import binascii
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import HTTPException, status
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request
from google.oauth2 import service_account

from app.core.config import get_settings

log = logging.getLogger("samvad.calendar")

API_BASE = "https://www.googleapis.com/calendar/v3"
SCOPES = ("https://www.googleapis.com/auth/calendar.events",)
PAGE_SIZE = 250  # Google's default; the maximum is 2500
MAX_PAGES = 20
RATE_LIMIT_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}

_http = httpx.AsyncClient(timeout=15)


@dataclass
class GoogleCalendar:
    credentials: service_account.Credentials
    calendar_id: str
    timezone: ZoneInfo
    http: httpx.AsyncClient = _http
    _refresh_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def events_url(self) -> str:
        return f"{API_BASE}/calendars/{quote(self.calendar_id, safe='')}/events"

    async def insert_event(self, event: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", self.events_url, json=event)

    async def delete_event(self, event_id: str) -> None:
        await self._request("DELETE", f"{self.events_url}/{quote(event_id, safe='')}")

    async def list_events(self, time_min: datetime, time_max: datetime, private_property: str) -> list[dict[str, Any]]:
        """Single events overlapping [time_min, time_max), filtered by one private extended property."""
        params: dict[str, Any] = {
            "timeMin": time_min.isoformat(),  # RFC3339 with an offset, as the API requires
            "timeMax": time_max.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": PAGE_SIZE,
            "privateExtendedProperty": private_property,
            "timeZone": self.timezone.key,
        }
        events: list[dict[str, Any]] = []
        for _ in range(MAX_PAGES):
            page = await self._request("GET", self.events_url, params=params)
            events.extend(page.get("items", []))
            if not page.get("nextPageToken"):
                return events
            params["pageToken"] = page["nextPageToken"]
        log.warning("Calendar listing stopped after %d pages", MAX_PAGES)
        return events

    async def _token(self) -> str:
        async with self._refresh_lock:
            if self.credentials.valid:
                return self.credentials.token
            try:
                await asyncio.to_thread(self.credentials.refresh, Request())
            except TransportError as exc:
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach Google sign-in") from exc
            except GoogleAuthError as exc:
                log.error("Google service account sign-in failed: %s", type(exc).__name__)
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY, "Google rejected the service account credentials"
                ) from exc
            return self.credentials.token

    async def _request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {await self._token()}"}
        try:
            r = await self.http.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach Google Calendar") from exc
        if r.status_code >= 400:
            raise _calendar_error(r, self.credentials.service_account_email)
        return r.json() if r.content else {}


def _calendar_error(r: httpx.Response, account_email: str) -> HTTPException:
    """Map a Google error response (https://developers.google.com/workspace/calendar/api/guides/errors)."""
    try:
        error = r.json().get("error", {})
    except ValueError:
        error = {}
    message = error.get("message", "") if isinstance(error, dict) else ""
    reasons = {e.get("reason") for e in error.get("errors", [])} if isinstance(error, dict) else set()
    log.warning("Google Calendar error %d: %s", r.status_code, message)

    if r.status_code == 429 or reasons & RATE_LIMIT_REASONS:
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Calendar is busy, try again shortly")
    if r.status_code == 401:
        return HTTPException(status.HTTP_502_BAD_GATEWAY, "Google rejected the service account credentials")
    if r.status_code == 403 and "forbiddenForServiceAccounts" in reasons:
        return HTTPException(
            status.HTTP_502_BAD_GATEWAY, "A service account cannot invite attendees without domain-wide delegation"
        )
    if r.status_code == 403 and "insufficientPermissions" in reasons:
        return HTTPException(status.HTTP_502_BAD_GATEWAY, "The service account's scope does not allow this call")
    if r.status_code == 403:
        return HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"The calendar is not shared with {account_email} (needs 'Make changes to events')",
        )
    if r.status_code == 404:
        return HTTPException(status.HTTP_502_BAD_GATEWAY, "Calendar or event not found, check GOOGLE_CALENDAR_ID")
    if r.status_code >= 500:
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Calendar is unavailable, try again shortly")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Google Calendar rejected the request: {message or r.status_code}")


def _load_key(raw: str) -> dict[str, Any]:
    """The key file's JSON, or base64 of it (easier to paste into a Railway variable)."""
    text = raw
    if not raw.lstrip().startswith("{"):
        try:
            text = base64.b64decode(raw, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise ValueError("not JSON or base64 JSON") from exc
    info = json.loads(text)
    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise ValueError("not a service account key")
    return info


_calendar: GoogleCalendar | None = None


def google_calendar() -> GoogleCalendar:
    """FastAPI dependency: the shared calendar client, or 503 when it is not configured."""
    global _calendar
    if _calendar is not None:
        return _calendar
    s = get_settings()
    if not s.google_service_account_json or not s.google_calendar_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Calendar is not configured on the server")
    try:
        timezone = ZoneInfo(s.google_calendar_timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "GOOGLE_CALENDAR_TIMEZONE is not a valid time zone") from exc
    try:
        credentials = service_account.Credentials.from_service_account_info(_load_key(s.google_service_account_json), scopes=SCOPES)
    except ValueError as exc:  # json.JSONDecodeError and google-auth's key errors are ValueErrors
        log.error("GOOGLE_SERVICE_ACCOUNT_JSON is invalid: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Calendar credentials are invalid") from exc
    _calendar = GoogleCalendar(credentials=credentials, calendar_id=s.google_calendar_id, timezone=timezone)
    return _calendar
