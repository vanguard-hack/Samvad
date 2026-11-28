"""Appointments: Google Calendar events (Google Meet calls), mirrored in Supabase.

book:    check the slot is free for the doctor and the patient -> claim an APT-#### id
         in Supabase -> create the Meet event, inviting the signed-in user -> link them.
doctors: the clinic's doctors for a slot, marked free or busy, with the patient's
         recommended department.
status:  change the status in the calendar event's description and in Supabase.
fetch:   list the doctor's Samvad events in a date range -> upsert them into Supabase -> return them.
"""

import asyncio
import datetime as dt
import logging
import uuid
from typing import Any

from fastapi import HTTPException, status

from app.core import languages
from app.core.google_calendar import GoogleCalendar
from app.repositories.appointment_repository import AppointmentRepository, from_row, to_synced_row
from app.repositories.clinic_repository import DoctorRepository, PatientRepository
from app.schemas.appointments import (
    Appointment,
    AppointmentDetails,
    AppointmentStatus,
    BookingIn,
    Department,
    DoctorDetails,
    DoctorSlot,
    DoctorsOut,
    FetchAppointmentsIn,
    FetchAppointmentsOut,
    PatientDetails,
    TimeSlot,
)
from app.services import appointment_event

log = logging.getLogger("samvad.appointments")

# Words in a patient's clinic, then their recorded conditions, that point to a department.
CLINIC_WORDS: dict[str, Department] = {
    "cardio": "cardiology", "heart": "cardiology",
    "endo": "endocrinology", "diabet": "endocrinology", "thyroid": "endocrinology",
    "ortho": "orthopaedics", "bone": "orthopaedics", "joint": "orthopaedics",
    "pulmo": "pulmonology", "lung": "pulmonology", "chest": "pulmonology", "respir": "pulmonology",
    "general": "generalMedicine", "medicine": "generalMedicine",
}
CONDITION_DEPARTMENTS: dict[str, Department] = {
    "heart": "cardiology", "hypertension": "cardiology",
    "diabetes": "endocrinology", "thyroid": "endocrinology",
    "asthma": "pulmonology",
    "kidney": "generalMedicine",
}

# One booking at a time in this process, so two clicks can't take the same slot.
_booking_lock = asyncio.Lock()


def recommend_department(patient: dict[str, Any]) -> Department:
    """The department for a patient: from their clinic if it names one, else their conditions."""
    clinic = (patient.get("clinic") or "").lower()
    for word, department in CLINIC_WORDS.items():
        if word in clinic:
            return department
    for condition in patient.get("conditions") or []:
        if condition in CONDITION_DEPARTMENTS:
            return CONDITION_DEPARTMENTS[condition]
    return "generalMedicine"


async def list_doctors(
    *,
    slot: TimeSlot | None,
    patient_id: uuid.UUID | None,
    calendar: GoogleCalendar,
    doctors: DoctorRepository,
    patients: PatientRepository,
) -> DoctorsOut:
    rows = await doctors.list_active()
    department = recommend_department(await _patient(patients, patient_id)) if patient_id else None
    busy = {a.doctor.id for a in await _booked_on(slot.date, calendar) if a.overlaps(slot)} if slot else set()
    listed = [
        DoctorSlot(
            id=d["code"],
            name=d["name"],
            department=d["department"],
            available=d["code"] not in busy,
            recommended=d["department"] == department,
        )
        for d in rows
    ]
    # Recommended and free first, then free, then busy.
    listed.sort(key=lambda d: (not d.available, not d.recommended, d.name))
    return DoctorsOut(doctors=listed, recommended_department=department)


async def book_appointment(
    body: BookingIn,
    *,
    user_id: str,
    user_email: str,
    calendar: GoogleCalendar,
    repo: AppointmentRepository,
    patients: PatientRepository,
    doctors: DoctorRepository,
) -> Appointment:
    tz = calendar.timezone
    if dt.datetime.combine(body.date, body.start, tzinfo=tz) <= dt.datetime.now(tz):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That time has already passed, pick a later slot")

    patient = await _patient(patients, body.patient_id)
    doctor = await doctors.get(body.doctor_id)
    if doctor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")
    details = AppointmentDetails(
        date=body.date,
        start=body.start,
        end=body.end,
        patient=PatientDetails(
            id=f"SMV-{patient['patient_number']}", name=patient["full_name"], age=patient.get("age"), sex=patient.get("sex")
        ),
        doctor=DoctorDetails(id=doctor["code"], name=doctor["name"], department=doctor["department"]),
        language=patient["language"] if patient.get("language") in languages.STT_REST else "en",
        visit=(patient.get("visits") or 0) + 1,
        notes=body.notes or None,
    )

    async with _booking_lock:
        for booked in await _booked_on(body.date, calendar):
            if not booked.overlaps(body):
                continue
            slot = f"{booked.start:%H:%M}-{booked.end:%H:%M}"
            if booked.doctor.id == details.doctor.id:
                raise HTTPException(status.HTTP_409_CONFLICT, f"{details.doctor.name} is already booked {slot} on that day")
            if booked.patient.id == details.patient.id:
                raise HTTPException(status.HTTP_409_CONFLICT, f"{details.patient.name} already has an appointment {slot} on that day")
        appointment = await _create(details, user_id=user_id, user_email=user_email, calendar=calendar, repo=repo)
    return appointment


async def _create(
    details: AppointmentDetails, *, user_id: str, user_email: str, calendar: GoogleCalendar, repo: AppointmentRepository
) -> Appointment:
    appointment_id = await repo.insert(details)
    guests = [user_email.lower()] if user_email else []
    appointment = Appointment(**details.model_dump(), id=appointment_id, attendees=guests)
    try:
        event = await calendar.insert_event(
            appointment_event.to_event(appointment, user_id, calendar.timezone), notify_guests=bool(guests)
        )
    except HTTPException:
        await _discard(repo, appointment_id)
        raise

    appointment = appointment.model_copy(
        update={
            "calendar_event_id": event.get("id"),
            "calendar_link": event.get("htmlLink"),
            "meeting_link": appointment_event.meet_link(event),
        }
    )
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


async def update_status(
    appointment_id: str, new_status: AppointmentStatus, *, calendar: GoogleCalendar, repo: AppointmentRepository
) -> Appointment:
    row = await repo.get(appointment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")

    appointment = from_row(row)
    if appointment.calendar_event_id:
        # The calendar holds the latest details (it may have been edited there); keep them.
        event = await calendar.get_event(appointment.calendar_event_id)
        appointment = appointment_event.from_event(event, calendar.timezone) or appointment
        appointment = appointment.model_copy(update={"status": new_status})
        await calendar.patch_event(
            appointment.calendar_event_id,
            {"summary": appointment_event.event_title(appointment), "description": appointment_event.event_description(appointment)},
        )
    else:
        appointment = appointment.model_copy(update={"status": new_status})

    await repo.update(appointment_id, {"status": new_status, "synced_at": _now().isoformat()})
    return appointment


async def fetch_appointments(
    body: FetchAppointmentsIn, *, user_id: str, calendar: GoogleCalendar, repo: AppointmentRepository
) -> FetchAppointmentsOut:
    events = await calendar.list_events(*_day_bounds(body.date_from, body.date_to, calendar), appointment_event.owner_filter(user_id))

    by_id: dict[str, Appointment] = {}  # one row per appointment id, even if an event was duplicated
    skipped: list[str] = []
    for event in events:
        appointment = appointment_event.from_event(event, calendar.timezone)
        if appointment is None:
            skipped.append(event.get("id", ""))
            continue
        by_id[appointment.id] = appointment

    appointments = list(by_id.values())
    synced_at = _now()
    await repo.upsert([to_synced_row(a, synced_at) for a in appointments])
    appointments.sort(key=lambda a: (a.date, a.start))
    return FetchAppointmentsOut(appointments=appointments, synced=len(appointments), skipped_event_ids=skipped)


async def _patient(patients: PatientRepository, patient_id: uuid.UUID) -> dict[str, Any]:
    patient = await patients.get(str(patient_id))
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return patient


async def _booked_on(day: dt.date, calendar: GoogleCalendar) -> list[Appointment]:
    """Every Samvad appointment on the clinic calendar that day (all doctors and users)."""
    events = await calendar.list_events(*_day_bounds(day, day, calendar))
    return [a for a in (appointment_event.from_event(e, calendar.timezone) for e in events) if a is not None]


def _day_bounds(first: dt.date, last: dt.date, calendar: GoogleCalendar) -> tuple[dt.datetime, dt.datetime]:
    tz = calendar.timezone
    return dt.datetime.combine(first, dt.time.min, tzinfo=tz), dt.datetime.combine(last + dt.timedelta(days=1), dt.time.min, tzinfo=tz)


async def _discard(repo: AppointmentRepository, appointment_id: str) -> None:
    """Remove the row of an appointment whose event could not be created (best effort)."""
    try:
        await repo.delete(appointment_id)
    except HTTPException as exc:
        log.warning("Could not remove %s after a calendar failure: %s", appointment_id, exc.detail)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)
