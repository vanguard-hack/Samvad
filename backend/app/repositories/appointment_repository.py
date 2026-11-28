"""Appointments in Supabase (public.appointments), read and written as the signed-in doctor.

Requests carry the doctor's own access token, so row-level security limits
them to that doctor's rows (no service-role key is used).
"""

import datetime as dt
import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.schemas.appointments import Appointment, AppointmentDetails

log = logging.getLogger("samvad.appointments")

_http = httpx.AsyncClient(timeout=15)


def to_row(a: AppointmentDetails) -> dict[str, Any]:
    """Columns for an appointment's details (everything except its id and calendar fields)."""
    return {
        "patient_number": a.patient.id,
        "patient_name": a.patient.name,
        "patient_age": a.patient.age,
        "patient_sex": a.patient.sex,
        "patient_phone": a.patient.phone,
        "doctor_code": a.doctor.id,
        "doctor_name": a.doctor.name,
        "department": a.doctor.department,
        "appointment_date": a.date.isoformat(),
        "start_time": a.start.strftime("%H:%M"),
        "end_time": a.end.strftime("%H:%M"),
        "language": a.language,
        "visit": a.visit,
        "status": a.status,
        "notes": a.notes,
    }


def to_synced_row(a: Appointment, synced_at: dt.datetime) -> dict[str, Any]:
    return {
        **to_row(a),
        "appointment_id": a.id,
        "calendar_event_id": a.calendar_event_id,
        "calendar_link": a.calendar_link,
        "synced_at": synced_at.isoformat(),
    }


class AppointmentRepository:
    def __init__(self, token: str, http: httpx.AsyncClient = _http):
        s = get_settings()
        self.url = f"{s.supabase_url}/rest/v1/appointments"
        self.headers = {"apikey": s.supabase_publishable_key, "Authorization": f"Bearer {token}"}
        self.http = http

    async def insert(self, a: AppointmentDetails) -> str:
        """Add a row and return the appointment id the database assigned (APT-####)."""
        rows = await self._request(
            "POST", params={"select": "appointment_id"}, json=to_row(a), prefer="return=representation"
        )
        return rows[0]["appointment_id"]

    async def update(self, appointment_id: str, values: dict[str, Any]) -> None:
        await self._request("PATCH", params={"appointment_id": f"eq.{appointment_id}"}, json=values, prefer="return=minimal")

    async def delete(self, appointment_id: str) -> None:
        await self._request("DELETE", params={"appointment_id": f"eq.{appointment_id}"}, prefer="return=minimal")

    async def upsert(self, rows: list[dict[str, Any]]) -> None:
        """Insert or update by appointment id (the calendar is the source of truth)."""
        if not rows:
            return
        await self._request(
            "POST",
            params={"on_conflict": "appointment_id"},
            json=rows,
            prefer="resolution=merge-duplicates,return=minimal",
        )

    async def _request(self, method: str, *, params: dict, json: Any = None, prefer: str) -> Any:
        try:
            r = await self.http.request(method, self.url, params=params, json=json, headers={**self.headers, "Prefer": prefer})
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach the database") from exc
        if r.status_code >= 400:
            raise _db_error(r)
        return r.json() if r.content else None


def _db_error(r: httpx.Response) -> HTTPException:
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
        return HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to change this appointment")
    if code == "23505" or r.status_code == 409:
        return HTTPException(status.HTTP_409_CONFLICT, "This appointment already exists")
    if code in ("23514", "22P02", "22007", "22008"):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Invalid appointment details: {message}")
    if code == "PGRST205" or code == "42P01":
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Appointments table is missing, apply the Supabase migrations")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not save appointments to the database")
