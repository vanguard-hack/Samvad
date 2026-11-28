"""The Samvad agent's own tools: the doctor's schedule and patients, plus the answer format.

They run as the signed-in doctor (their Supabase token, so row-level security
applies) next to the read-only Wispr Flow MCP tools. Tool names stay internal:
the prompt tells Claude never to show them, and `humanize_tool_names` scrubs
any that slip into an answer.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from app.core.google_calendar import google_calendar
from app.repositories.appointment_repository import AppointmentRepository
from app.repositories.patient_repository import Db as PatientDb
from app.schemas.appointments import MAX_RANGE_DAYS, Appointment, FetchAppointmentsIn
from app.services import appointment_service

ANSWER_TOOL = "present_answer"
MAX_LISTED = 60  # appointments returned to Claude per lookup
PATIENT_COLUMNS = "patient_number,full_name,age,sex,language,status,visits,last_visit,clinic,reason,queue_status"

STATUSES = ["scheduled", "active", "needsReview", "followUp", "closed"]
DEPARTMENTS = ["generalMedicine", "cardiology", "endocrinology", "orthopaedics", "pulmonology"]

TOOLS: list[dict[str, Any]] = [
    {
        "name": "find_appointments",
        "description": (
            "The doctor's consultation appointments (synced from their calendar) between two dates, "
            f"inclusive, at most {MAX_RANGE_DAYS} days apart. Optional filters narrow the list. "
            "Returns id (APT-####), date, start, end, patient, doctor, department, language, visit, status."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "from": {"type": "string", "description": "First date, YYYY-MM-DD"},
                "to": {"type": "string", "description": "Last date, YYYY-MM-DD"},
                "patient": {"type": "string", "description": "Patient id (SMV-####) or part of the name"},
                "doctor": {"type": "string", "description": "Doctor id (DOC-##) or part of the name"},
                "department": {"type": "string", "enum": DEPARTMENTS},
                "status": {"type": "array", "items": {"type": "string", "enum": STATUSES}},
            },
            "required": ["from", "to"],
        },
    },
    {
        "name": "find_patients",
        "description": (
            "Registered patients of this doctor matching a name or patient id (SMV-####). "
            "Returns id, name, age, sex, language, status, visits, last visit, clinic, reason for visit."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Name, part of a name, or SMV-####"}},
            "required": ["query"],
        },
    },
    {
        "name": ANSWER_TOOL,
        "description": "Give the doctor your final answer. Call it exactly once, alone, as your last step.",
        "input_schema": {
            "type": "object",
            "properties": {
                "paragraphs": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "The answer as 1-6 short plain-text paragraphs, in the doctor's language. No markdown.",
                },
                "appointment_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Ids (APT-####) of appointments from your lookups to show as cards, in display order",
                },
                "suggestions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Up to 3 short follow-up questions the doctor might ask next, in their language",
                },
            },
            "required": ["paragraphs"],
        },
    },
]
NAMES = {t["name"] for t in TOOLS}


@dataclass
class SamvadTools:
    """One query's native tools, acting as the signed-in doctor."""

    user_id: str
    token: str
    found: dict[str, Appointment] = field(default_factory=dict)  # appointments seen this turn, by id

    async def call(self, name: str, args: dict[str, Any]) -> tuple[str, bool]:
        try:
            if name == "find_appointments":
                return await self._find_appointments(args), False
            if name == "find_patients":
                return await self._find_patients(args), False
        except HTTPException as exc:
            return f"Lookup failed: {exc.detail}", True
        except (ValidationError, ValueError) as exc:
            return f"Invalid request: {exc}", True
        return f"Unknown tool {name}", True

    async def _find_appointments(self, args: dict[str, Any]) -> str:
        body = FetchAppointmentsIn.model_validate({"from": args.get("from"), "to": args.get("to")})
        result = await appointment_service.fetch_appointments(
            body, user_id=self.user_id, calendar=google_calendar(), repo=AppointmentRepository(self.token)
        )
        rows = [a for a in result.appointments if _matches(a, args)]
        for a in rows:
            self.found[a.id] = a
        listed = [_appointment_summary(a) for a in rows[:MAX_LISTED]]
        return json.dumps({"count": len(rows), "appointments": listed, "truncated": len(rows) > MAX_LISTED})

    async def _find_patients(self, args: dict[str, Any]) -> str:
        query = str(args.get("query", "")).strip()
        if not query:
            raise ValueError("query is required")
        number = re.fullmatch(r"(?i)(?:SMV-?)?(\d{3,})", query)
        params = {"select": PATIENT_COLUMNS, "order": "full_name", "limit": "20"}
        if number:
            params["patient_number"] = f"eq.{number.group(1)}"
        else:
            params["full_name"] = f"ilike.*{_escape_like(query)}*"
        try:
            rows = await PatientDb(self.token).request("GET", params=params)
        except Exception as exc:  # ToolError from the repository
            raise HTTPException(502, str(exc)) from exc
        patients = [{**{k: v for k, v in r.items() if k != "patient_number"}, "id": f"SMV-{r['patient_number']}"} for r in rows or []]
        return json.dumps({"count": len(patients), "patients": patients}, default=str)


def _matches(a: Appointment, args: dict[str, Any]) -> bool:
    patient = str(args.get("patient") or "").strip().lower()
    doctor = str(args.get("doctor") or "").strip().lower()
    if patient and patient not in a.patient.id.lower() and patient not in a.patient.name.lower():
        return False
    if doctor and doctor not in a.doctor.id.lower() and doctor not in a.doctor.name.lower():
        return False
    if args.get("department") and a.doctor.department != args["department"]:
        return False
    return not args.get("status") or a.status in args["status"]


def _appointment_summary(a: Appointment) -> dict[str, Any]:
    return {
        "id": a.id,
        "date": a.date.isoformat(),
        "weekday": a.date.strftime("%A"),
        "start": a.start.strftime("%H:%M"),
        "end": a.end.strftime("%H:%M"),
        "patient": {"id": a.patient.id, "name": a.patient.name, "age": a.patient.age, "sex": a.patient.sex},
        "doctor": {"id": a.doctor.id, "name": a.doctor.name},
        "department": a.doctor.department,
        "language": a.language,
        "visit": a.visit,
        "status": a.status,
        "notes": a.notes,
    }


def _escape_like(text: str) -> str:
    """PostgREST ilike pattern: drop characters with special meaning in the filter syntax."""
    return re.sub(r"[*%,()\\]", " ", text).strip()


def today_line(now: dt.datetime) -> str:
    return f"Now: {now.strftime('%A %d %B %Y, %H:%M')} ({now.tzinfo}). Today is {now.date().isoformat()}."


_SNAKE = re.compile(r"\b[a-z]+(?:_[a-z]+)+\b")


def humanize_tool_names(text: str, tool_names: set[str]) -> str:
    """Replace any internal tool name that slipped into an answer with plain words."""
    return _SNAKE.sub(lambda m: m.group(0).replace("_", " ") if m.group(0) in tool_names else m.group(0), text)
