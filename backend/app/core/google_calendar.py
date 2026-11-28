"""Google Calendar API v3, signed in as the clinic's Google account (OAuth).

The backend acts as one Google account, signed in once with
scripts/google_oauth_login.py. Its credentials come only from env variables
(GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN), so they live in Railway
secrets and never in the (public) repo. As a real account it can create
Google Meet links and email invites, which a service account cannot.
Scope: calendar.events, the narrowest one that covers listing and creating events.

google-auth refreshes the access token; the REST calls go through httpx so they
stay async. Every Google failure becomes an HTTPException with a clear message.

Reference: https://developers.google.com/workspace/calendar/api/v3/reference/events
"""

import asyncio
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
from google.oauth2.credentials import Credentials

from app.core.config import get_settings

log = logging.getLogger("samvad.calendar")

API_BASE = "https://www.googleapis.com/calendar/v3"
SCOPES = ("https://www.googleapis.com/auth/calendar.events",)
TOKEN_URI = "https://oauth2.googleapis.com/token"
PAGE_SIZE = 250  # Google's default; the maximum is 2500
MAX_PAGES = 20
RATE_LIMIT_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}
SIGN_IN_AGAIN = (
    "Google sign-in has expired or was revoked: run scripts/google_oauth_login.py "
    "and update GOOGLE_OAUTH_REFRESH_TOKEN"
)

_http = httpx.AsyncClient(timeout=15)


@dataclass
class GoogleCalendar:
    credentials: Credentials
    calendar_id: str
    timezone: ZoneInfo
    http: httpx.AsyncClient = _http
    _refresh_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def events_url(self) -> str:
        return f"{API_BASE}/calendars/{quote(self.calendar_id, safe='')}/events"

    async def insert_event(self, event: dict[str, Any], *, notify_guests: bool = False) -> dict[str, Any]:
        """Create an event. conferenceDataVersion=1 lets it carry a Meet request; guests get emails if notified."""
        params = {"conferenceDataVersion": 1, "sendUpdates": "all" if notify_guests else "none"}
        return await self._request("POST", self.events_url, params=params, json=event)

    async def get_event(self, event_id: str) -> dict[str, Any]:
        return await self._request("GET", self._event_url(event_id))

    async def patch_event(self, event_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", self._event_url(event_id), json=changes)

    async def delete_event(self, event_id: str) -> None:
        await self._request("DELETE", self._event_url(event_id))

    async def list_events(
        self, time_min: datetime, time_max: datetime, private_property: str | None = None
    ) -> list[dict[str, Any]]:
        """Single events overlapping [time_min, time_max), optionally filtered by one private extended property."""
        params: dict[str, Any] = {
            "timeMin": time_min.isoformat(),  # RFC3339 with an offset, as the API requires
            "timeMax": time_max.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": PAGE_SIZE,
            "timeZone": self.timezone.key,
        }
        if private_property:
            params["privateExtendedProperty"] = private_property
        events: list[dict[str, Any]] = []
        for _ in range(MAX_PAGES):
            page = await self._request("GET", self.events_url, params=params)
            events.extend(page.get("items", []))
            if not page.get("nextPageToken"):
                return events
            params["pageToken"] = page["nextPageToken"]
        log.warning("Calendar listing stopped after %d pages", MAX_PAGES)
        return events

    def _event_url(self, event_id: str) -> str:
        return f"{self.events_url}/{quote(event_id, safe='')}"

    async def _token(self) -> str:
        async with self._refresh_lock:
            if self.credentials.valid:
                return self.credentials.token
            try:
                await asyncio.to_thread(self.credentials.refresh, Request())
            except TransportError as exc:
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach Google sign-in") from exc
            except GoogleAuthError as exc:
                log.error("Google sign-in failed: %s", type(exc).__name__)
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, SIGN_IN_AGAIN) from exc
            return self.credentials.token

    async def _request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {await self._token()}"}
        try:
            r = await self.http.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach Google Calendar") from exc
        if r.status_code >= 400:
            raise _calendar_error(r)
        return r.json() if r.content else {}


def _calendar_error(r: httpx.Response) -> HTTPException:
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
        return HTTPException(status.HTTP_502_BAD_GATEWAY, SIGN_IN_AGAIN)
    if r.status_code == 403 and ("accessNotConfigured" in reasons or "has not been used in project" in message):
        # The OAuth client's Google Cloud project hasn't enabled the Calendar API (e.g. after switching accounts).
        return HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The Google Calendar API is not enabled in the Google Cloud project of GOOGLE_OAUTH_CLIENT_ID: "
            "enable it in Google Cloud Console (APIs & Services → Library → Google Calendar API)",
        )
    if r.status_code == 403 and "insufficientPermissions" in reasons:
        return HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Google sign-in lacks calendar access: sign in again and allow Google Calendar"
        )
    if r.status_code == 403:
        return HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The signed-in Google account cannot change this calendar (check GOOGLE_CALENDAR_ID)"
        )
    if r.status_code == 404:
        return HTTPException(status.HTTP_502_BAD_GATEWAY, "Calendar or event not found (check GOOGLE_CALENDAR_ID)")
    if r.status_code == 410:
        return HTTPException(status.HTTP_502_BAD_GATEWAY, "The calendar event was deleted in Google Calendar")
    if r.status_code >= 500:
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Calendar is unavailable, try again shortly")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Google Calendar rejected the request: {message or r.status_code}")


_calendar: GoogleCalendar | None = None


def google_calendar() -> GoogleCalendar:
    """FastAPI dependency: the shared calendar client, or 503 when Google sign-in is not configured."""
    global _calendar
    if _calendar is not None:
        return _calendar
    s = get_settings()
    if not s.google_oauth_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Google Calendar is not configured: set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET "
            "and GOOGLE_OAUTH_REFRESH_TOKEN",
        )
    try:
        timezone = ZoneInfo(s.google_calendar_timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "GOOGLE_CALENDAR_TIMEZONE is not a valid time zone") from exc
    credentials = Credentials(
        token=None,
        refresh_token=s.google_oauth_refresh_token,
        client_id=s.google_oauth_client_id,
        client_secret=s.google_oauth_client_secret,
        token_uri=TOKEN_URI,
        scopes=list(SCOPES),
    )
    _calendar = GoogleCalendar(credentials=credentials, calendar_id=s.google_calendar_id, timezone=timezone)
    return _calendar
