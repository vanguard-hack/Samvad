"""Appointments: Google Calendar events, mirrored in Supabase.

create:  claim an APT-#### id in Supabase -> create the calendar event -> store the event id.
fetch:   list the doctor's Samvad events in a date range -> upsert them into Supabase -> return them.
"""

import datetime as dt
import logging

from fastapi import HTTPException

from app.core.google_calendar import GoogleCalendar
from app.repositories.appointment_repository import AppointmentRepository, to_synced_row
from app.schemas.appointments import Appointment, AppointmentCreate, FetchAppointmentsIn, FetchAppointmentsOut
from app.services import appointment_event

log = logging.getLogger("samvad.appointments")


async def create_appointment(
    body: AppointmentCreate, *, user_id: str, calendar: GoogleCalendar, repo: AppointmentRepository
) -> Appointment:
    appointment_id = await repo.insert(body)
    appointment = Appointment(**body.model_dump(), id=appointment_id)
    try:
        event = await calendar.insert_event(appointment_event.to_event(appointment, user_id, calendar.timezone))
    except HTTPException:
        await _discard(repo, appointment_id)
        raise

    appointment = appointment.model_copy(update={"calendar_event_id": event.get("id"), "calendar_link": event.get("htmlLink")})
    try:
        await repo.update(
            appointment_id,
            {
                "calendar_event_id": appointment.calendar_event_id,
                "calendar_link": appointment.calendar_link,
                "synced_at": _now().isoformat(),
            },
        )
    except HTTPException as exc:
        # The event exists and the row exists; the next fetch-appointments sync links them.
        log.warning("Event created but not linked to %s: %s", appointment_id, exc.detail)
    return appointment


async def fetch_appointments(
    body: FetchAppointmentsIn, *, user_id: str, calendar: GoogleCalendar, repo: AppointmentRepository
) -> FetchAppointmentsOut:
    tz = calendar.timezone
    time_min = dt.datetime.combine(body.date_from, dt.time.min, tzinfo=tz)
    time_max = dt.datetime.combine(body.date_to + dt.timedelta(days=1), dt.time.min, tzinfo=tz)
    events = await calendar.list_events(time_min, time_max, appointment_event.owner_filter(user_id))

    by_id: dict[str, Appointment] = {}  # one row per appointment id, even if an event was duplicated
    skipped: list[str] = []
    for event in events:
        appointment = appointment_event.from_event(event, tz)
        if appointment is None:
            skipped.append(event.get("id", ""))
            continue
        by_id[appointment.id] = appointment

    appointments = list(by_id.values())
    synced_at = _now()
    await repo.upsert([to_synced_row(a, synced_at) for a in appointments])
    appointments.sort(key=lambda a: (a.date, a.start))
    return FetchAppointmentsOut(appointments=appointments, synced=len(appointments), skipped_event_ids=skipped)


async def _discard(repo: AppointmentRepository, appointment_id: str) -> None:
    """Remove the row of an appointment whose event could not be created (best effort)."""
    try:
        await repo.delete(appointment_id)
    except HTTPException as exc:
        log.warning("Could not remove %s after a calendar failure: %s", appointment_id, exc.detail)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)
