"""Consultation appointments on Google Calendar, mirrored in Supabase (sign-in required).

  GET   /api/doctors                 the clinic's doctors, free or busy in a slot
  POST  /api/appointments            book a slot for a patient with a doctor (Meet link emailed to you)
  PATCH /api/appointments/{id}       change an appointment's status
  POST  /api/fetch-appointments      sync and list appointments in a date range
"""

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import ValidationError

from app.api.dependencies import current_email, current_session
from app.core.google_calendar import GoogleCalendar, google_calendar
from app.repositories.appointment_repository import AppointmentRepository
from app.repositories.clinic_repository import DoctorRepository, PatientRepository
from app.schemas.appointments import (
    Appointment,
    AppointmentStatusIn,
    BookingIn,
    DoctorsOut,
    FetchAppointmentsIn,
    FetchAppointmentsOut,
    TimeSlot,
)
from app.services import appointment_service

router = APIRouter(tags=["appointments"])


def appointment_repository(session: tuple[str, str] = Depends(current_session)) -> AppointmentRepository:
    return AppointmentRepository(token=session[1])


def patient_repository(session: tuple[str, str] = Depends(current_session)) -> PatientRepository:
    return PatientRepository(token=session[1])


def doctor_repository(session: tuple[str, str] = Depends(current_session)) -> DoctorRepository:
    return DoctorRepository(token=session[1])


@router.get("/doctors", response_model=DoctorsOut)
async def list_doctors(
    date: dt.date | None = None,
    start: dt.time | None = None,
    end: dt.time | None = None,
    patient_id: uuid.UUID | None = Query(default=None, alias="patientId"),
    doctors: DoctorRepository = Depends(doctor_repository),  # first, so sign-in is checked first
    patients: PatientRepository = Depends(patient_repository),
    calendar: GoogleCalendar = Depends(google_calendar),
) -> DoctorsOut:
    """Active doctors. With date + start + end, each says whether it is free then; with patientId,
    the doctors of the patient's department are marked recommended."""
    given = [v is not None for v in (date, start, end)]
    if any(given) and not all(given):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give date, start and end together, or none of them")
    try:
        slot = TimeSlot(date=date, start=start, end=end) if all(given) else None
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.errors()[0]["msg"]) from None
    return await appointment_service.list_doctors(
        slot=slot, patient_id=patient_id, calendar=calendar, doctors=doctors, patients=patients
    )


@router.post("/appointments", response_model=Appointment, status_code=status.HTTP_201_CREATED)
async def book_appointment(
    body: BookingIn,
    session: tuple[str, str] = Depends(current_session),
    user_email: str = Depends(current_email),
    repo: AppointmentRepository = Depends(appointment_repository),
    patients: PatientRepository = Depends(patient_repository),
    doctors: DoctorRepository = Depends(doctor_repository),
    calendar: GoogleCalendar = Depends(google_calendar),
) -> Appointment:
    """Book a consultation: the server checks the slot, assigns the APT-#### id, adds a Google Meet
    link and emails the invite (with the patient and doctor details) to the signed-in user."""
    return await appointment_service.book_appointment(
        body,
        user_id=session[0],
        user_email=user_email,
        calendar=calendar,
        repo=repo,
        patients=patients,
        doctors=doctors,
    )


@router.patch("/appointments/{appointment_id}", response_model=Appointment)
async def update_appointment_status(
    body: AppointmentStatusIn,
    appointment_id: str = Path(pattern=r"^APT-\d{4,}$"),
    repo: AppointmentRepository = Depends(appointment_repository),  # first, so sign-in is checked first
    calendar: GoogleCalendar = Depends(google_calendar),
) -> Appointment:
    """Change an appointment's status, in its calendar event and in the database."""
    return await appointment_service.update_status(appointment_id, body.status, calendar=calendar, repo=repo)


@router.post("/fetch-appointments", response_model=FetchAppointmentsOut)
async def fetch_appointments(
    body: FetchAppointmentsIn,
    session: tuple[str, str] = Depends(current_session),
    repo: AppointmentRepository = Depends(appointment_repository),
    calendar: GoogleCalendar = Depends(google_calendar),
) -> FetchAppointmentsOut:
    """Sync the signed-in user's Samvad events in [from, to] (inclusive dates) and return them."""
    return await appointment_service.fetch_appointments(body, user_id=session[0], calendar=calendar, repo=repo)
