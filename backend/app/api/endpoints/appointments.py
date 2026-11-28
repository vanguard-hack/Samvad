"""Consultation appointments on Google Calendar, mirrored in Supabase (doctor sign-in required)."""

from fastapi import APIRouter, Depends, Path, status

from app.api.dependencies import current_session
from app.core.google_calendar import GoogleCalendar, google_calendar
from app.repositories.appointment_repository import AppointmentRepository
from app.schemas.appointments import (
    Appointment,
    AppointmentCreate,
    AppointmentStatusIn,
    FetchAppointmentsIn,
    FetchAppointmentsOut,
)
from app.services import appointment_service

router = APIRouter(tags=["appointments"])


def appointment_repository(session: tuple[str, str] = Depends(current_session)) -> AppointmentRepository:
    return AppointmentRepository(token=session[1])


@router.post("/fetch-appointments", response_model=FetchAppointmentsOut)
async def fetch_appointments(
    body: FetchAppointmentsIn,
    session: tuple[str, str] = Depends(current_session),
    calendar: GoogleCalendar = Depends(google_calendar),
    repo: AppointmentRepository = Depends(appointment_repository),
) -> FetchAppointmentsOut:
    """Sync the doctor's Samvad events in [from, to] (inclusive dates) and return them as appointments."""
    return await appointment_service.fetch_appointments(body, user_id=session[0], calendar=calendar, repo=repo)


@router.post("/appointments", response_model=Appointment, status_code=status.HTTP_201_CREATED)
async def create_appointment(
    body: AppointmentCreate,
    session: tuple[str, str] = Depends(current_session),
    calendar: GoogleCalendar = Depends(google_calendar),
    repo: AppointmentRepository = Depends(appointment_repository),
) -> Appointment:
    """Create the calendar event for an appointment; the server assigns its APT-#### id."""
    return await appointment_service.create_appointment(body, user_id=session[0], calendar=calendar, repo=repo)


@router.patch("/appointments/{appointment_id}", response_model=Appointment)
async def update_appointment_status(
    body: AppointmentStatusIn,
    appointment_id: str = Path(pattern=r"^APT-\d{4,}$"),
    repo: AppointmentRepository = Depends(appointment_repository),  # first, so sign-in is checked first
    calendar: GoogleCalendar = Depends(google_calendar),
) -> Appointment:
    """Change an appointment's status, in its calendar event and in the database."""
    return await appointment_service.update_status(appointment_id, body.status, calendar=calendar, repo=repo)
