"""Appointments in Supabase (public.appointments), read and written as the signed-in doctor.

Row-level security limits every request to that doctor's own rows.
"""

import datetime as dt
from typing import Any

from app.repositories.supabase_rest import SupabaseTable
from app.schemas.appointments import Appointment, AppointmentDetails


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


def from_row(row: dict[str, Any]) -> Appointment:
    return Appointment.model_validate(
        {
            "id": row["appointment_id"],
            "patient": {
                "id": row["patient_number"],
                "name": row["patient_name"],
                "age": row.get("patient_age"),
                "sex": row.get("patient_sex"),
                "phone": row.get("patient_phone"),
            },
            "doctor": {"id": row["doctor_code"], "name": row["doctor_name"], "department": row["department"]},
            "date": row["appointment_date"],
            "start": row["start_time"],
            "end": row["end_time"],
            "language": row["language"],
            "visit": row["visit"],
            "status": row["status"],
            "notes": row.get("notes"),
            "calendar_event_id": row.get("calendar_event_id"),
            "calendar_link": row.get("calendar_link"),
        }
    )


class AppointmentRepository(SupabaseTable):
    table = "appointments"
    label = "appointments"

    async def insert(self, a: AppointmentDetails) -> str:
        """Add a row and return the appointment id the database assigned (APT-####)."""
        rows = await self._request("POST", params={"select": "appointment_id"}, json=to_row(a))
        return rows[0]["appointment_id"]

    async def get(self, appointment_id: str) -> dict[str, Any] | None:
        """The doctor's row for an appointment id, or None (RLS hides other doctors' rows)."""
        rows = await self._request("GET", params={"appointment_id": f"eq.{appointment_id}", "select": "*"})
        return rows[0] if rows else None

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
