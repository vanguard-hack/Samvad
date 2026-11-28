"""Appointment schemas, mirroring the frontend's Consultations page.

See frontend/src/data/appointments.ts (SampleAppointment, SampleDoctor) and
frontend/src/data/sample.ts (SamplePatient). JSON uses the frontend's camelCase
names; Python code uses snake_case.
"""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_serializer, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.core import languages

Department = Literal["generalMedicine", "cardiology", "endocrinology", "orthopaedics", "pulmonology"]
AppointmentStatus = Literal["scheduled", "active", "needsReview", "followUp", "closed"]
Sex = Literal["F", "M", "O"]

MAX_RANGE_DAYS = 92


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


class AppointmentDetails(CamelModel):
    """Everything about an appointment except its id. Date and times are in the clinic's time zone."""

    patient: PatientDetails
    doctor: DoctorDetails
    date: dt.date
    start: dt.time = Field(description="HH:mm, 24-hour")
    end: dt.time = Field(description="HH:mm, 24-hour")
    language: str = Field(description="LANGUAGES code the consultation is held in, e.g. 'kn'")
    visit: int = Field(default=1, ge=1, description="The patient's nth visit")
    status: AppointmentStatus = "scheduled"
    notes: str | None = Field(default=None, max_length=500)
    meeting_link: str | None = Field(
        default=None,
        max_length=500,
        pattern=r"^https://\S+$",
        description="Video call link (Google Meet, Zoom, ...); makes the event a joinable meeting",
    )

    @field_validator("language")
    @classmethod
    def known_language(cls, code: str) -> str:
        if code not in languages.STT_REST:
            raise ValueError("unsupported language code")
        return code

    @model_validator(mode="after")
    def end_after_start(self) -> "AppointmentDetails":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self

    @field_serializer("start", "end")
    def hh_mm(self, value: dt.time) -> str:
        return value.strftime("%H:%M")


class AppointmentCreate(AppointmentDetails):
    """POST /api/appointments body. The server assigns the appointment id."""


class Appointment(AppointmentDetails):
    id: str = Field(pattern=r"^APT-\d{4,}$", examples=["APT-2021"])
    calendar_event_id: str | None = None
    calendar_link: str | None = None

    # The flat ids of the frontend's SampleAppointment, next to the nested details.
    @computed_field
    @property
    def patient_id(self) -> str:
        return self.patient.id

    @computed_field
    @property
    def doctor_id(self) -> str:
        return self.doctor.id


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
