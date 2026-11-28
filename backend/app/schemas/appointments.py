"""Appointment schemas, mirroring the frontend's Consultations page.

See frontend/src/data/appointments.ts (SampleAppointment, SampleDoctor). JSON
uses the frontend's camelCase names; Python code uses snake_case.
"""

import datetime as dt
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_serializer, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.core import languages

Department = Literal["generalMedicine", "cardiology", "endocrinology", "orthopaedics", "pulmonology"]
AppointmentStatus = Literal["scheduled", "active", "needsReview", "followUp", "closed"]
Sex = Literal["F", "M", "O"]

MAX_RANGE_DAYS = 92
MAX_SLOT_MINUTES = 240


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)


class PatientDetails(CamelModel):
    id: str = Field(pattern=r"^SMV-\d{4,}$", examples=["SMV-1001"])
    name: str = Field(min_length=1, max_length=80)
    age: int | None = Field(default=None, ge=0, le=120)
    sex: Sex | None = None
    phone: str | None = Field(default=None, pattern=r"^[6-9]\d{9}$", description="10-digit Indian mobile number")


class DoctorDetails(CamelModel):
    id: str = Field(pattern=r"^DOC-\d{2,}$", examples=["DOC-03"])
    name: str = Field(min_length=1, max_length=80)
    department: Department


class TimeSlot(CamelModel):
    """A slot on one day, in the clinic's time zone."""

    date: dt.date
    start: dt.time = Field(description="HH:mm, 24-hour")
    end: dt.time = Field(description="HH:mm, 24-hour")

    @model_validator(mode="after")
    def valid_slot(self) -> "TimeSlot":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        minutes = (self.end.hour * 60 + self.end.minute) - (self.start.hour * 60 + self.start.minute)
        if minutes > MAX_SLOT_MINUTES:
            raise ValueError(f"a slot can be at most {MAX_SLOT_MINUTES} minutes")
        return self

    @field_serializer("start", "end")
    def hh_mm(self, value: dt.time) -> str:
        return value.strftime("%H:%M")

    def overlaps(self, other: "TimeSlot") -> bool:
        return self.date == other.date and self.start < other.end and other.start < self.end


class AppointmentDetails(TimeSlot):
    """Everything about an appointment except its id."""

    patient: PatientDetails
    doctor: DoctorDetails
    language: str = Field(description="LANGUAGES code the consultation is held in, e.g. 'kn'")
    visit: int = Field(default=1, ge=1, description="The patient's nth visit")
    status: AppointmentStatus = "scheduled"
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("language")
    @classmethod
    def known_language(cls, code: str) -> str:
        if code not in languages.STT_REST:
            raise ValueError("unsupported language code")
        return code


class Appointment(AppointmentDetails):
    id: str = Field(pattern=r"^APT-\d{4,}$", examples=["APT-2021"])
    calendar_event_id: str | None = None
    calendar_link: str | None = None
    meeting_link: str | None = Field(default=None, description="The Google Meet link of the consultation")
    attendees: list[str] = Field(default_factory=list, description="Emails invited to the calendar event")

    # The flat ids of the frontend's SampleAppointment, next to the nested details.
    @computed_field
    @property
    def patient_id(self) -> str:
        return self.patient.id

    @computed_field
    @property
    def doctor_id(self) -> str:
        return self.doctor.id


class BookingIn(TimeSlot):
    """POST /api/appointments body: a slot, a patient from the database and a doctor.

    The server fills in the rest from the database (patient details, language, visit
    number), assigns the APT-#### id, adds a Google Meet link and emails the invite to
    the signed-in user.
    """

    patient_id: uuid.UUID = Field(description="The patient's database id (patients.id)")
    doctor_id: str = Field(pattern=r"^DOC-\d{2,}$", description="The doctor's code, e.g. DOC-03")
    notes: str | None = Field(default=None, max_length=500)


class DoctorSlot(CamelModel):
    """A doctor for the booking form, with whether they are free in the slot asked about."""

    id: str
    name: str
    department: Department
    available: bool
    recommended: bool = Field(description="Matches the patient's department (from their clinic or conditions)")


class DoctorsOut(CamelModel):
    doctors: list[DoctorSlot]
    recommended_department: Department | None = None


class AppointmentStatusIn(CamelModel):
    """PATCH /api/appointments/{id} body."""

    status: AppointmentStatus


class FetchAppointmentsIn(CamelModel):
    """POST /api/fetch-appointments body: an inclusive date range in the clinic's time zone."""

    date_from: dt.date = Field(alias="from")
    date_to: dt.date = Field(alias="to")

    @model_validator(mode="after")
    def valid_range(self) -> "FetchAppointmentsIn":
        if self.date_to < self.date_from:
            raise ValueError("'to' must be on or after 'from'")
        if (self.date_to - self.date_from).days >= MAX_RANGE_DAYS:
            raise ValueError(f"date range must be at most {MAX_RANGE_DAYS} days")
        return self


class FetchAppointmentsOut(CamelModel):
    appointments: list[Appointment]
    synced: int = Field(description="Appointments written to the database")
    skipped_event_ids: list[str] = Field(description="Samvad events whose details could not be read")
