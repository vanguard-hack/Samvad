"""Appointment <-> Google Calendar event.

The title is for people:  "APT-2021 · Lakshmi Narayan (SMV-1001) · Dr. Farah Siddiqui".
The description is for people and for us: one "Label: value" line per field,
so it reads well in Google Calendar and parses back into an Appointment.
Every appointment is a Google Meet call; its guests (the signed-in user) get
the invite email with the Meet link and these details.
The event's own start and end are the slot (moving the event in Google Calendar
moves the appointment). Two private extended properties tie the event to Samvad:
the appointment id and the owning doctor's user id, used to filter on sync.
"""

import datetime as dt
import uuid
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.schemas.appointments import Appointment

HEADER = "Samvad appointment"
PROP_APPOINTMENT_ID = "samvadAppointmentId"
PROP_OWNER = "samvadOwner"

# Description label -> dotted field path on Appointment. Order is the display order.
LABELS: dict[str, str] = {
    "Appointment ID": "id",
    "Patient ID": "patient.id",
    "Patient name": "patient.name",
    "Patient age": "patient.age",
    "Patient sex": "patient.sex",
    "Patient phone": "patient.phone",
    "Doctor ID": "doctor.id",
    "Doctor name": "doctor.name",
    "Department": "doctor.department",
    "Date": "date",
    "Time slot": "time_slot",
    "Language": "language",
    "Visit": "visit",
    "Status": "status",
    "Notes": "notes",
}


def owner_filter(user_id: str) -> str:
    """events.list privateExtendedProperty value for one doctor's appointments."""
    return f"{PROP_OWNER}={user_id}"


def event_title(a: Appointment) -> str:
    return f"{a.id} · {a.patient.name} ({a.patient.id}) · {a.doctor.name}"


def event_description(a: Appointment) -> str:
    values = a.model_dump(mode="json", by_alias=False)
    values["time_slot"] = f"{values['start']}-{values['end']}"
    lines = [HEADER]
    for label, path in LABELS.items():
        value = _get(values, path)
        if value not in (None, ""):
            lines.append(f"{label}: {_one_line(str(value))}")
    return "\n".join(lines)


def to_event(a: Appointment, owner_id: str, tz: ZoneInfo) -> dict[str, Any]:
    """events.insert body: the appointment as a Google Meet call, with `a.attendees` as guests."""
    return {
        "summary": event_title(a),
        "description": event_description(a),
        "start": {"dateTime": dt.datetime.combine(a.date, a.start).isoformat(), "timeZone": tz.key},
        "end": {"dateTime": dt.datetime.combine(a.date, a.end).isoformat(), "timeZone": tz.key},
        "extendedProperties": {"private": {PROP_APPOINTMENT_ID: a.id, PROP_OWNER: owner_id}},
        "attendees": [{"email": email} for email in a.attendees],
        "conferenceData": {
            "createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}
        },
    }


def meet_link(event: dict[str, Any]) -> str | None:
    """The event's Google Meet link, if it has one."""
    if event.get("hangoutLink"):
        return event["hangoutLink"]
    for entry in (event.get("conferenceData") or {}).get("entryPoints", []):
        if entry.get("entryPointType") == "video" and entry.get("uri"):
            return entry["uri"]
    return None


def from_event(event: dict[str, Any], tz: ZoneInfo) -> Appointment | None:
    """Parse an event back into an Appointment; None if it is not a readable Samvad appointment."""
    start, end = _event_time(event.get("start"), tz), _event_time(event.get("end"), tz)
    if start is None or end is None:
        return None  # all-day events have no slot
    fields = parse_description(event.get("description") or "")
    fields["id"] = (event.get("extendedProperties") or {}).get("private", {}).get(PROP_APPOINTMENT_ID) or fields.get("id")
    fields.pop("time_slot", None)
    fields.update(
        date=start.date(),
        start=start.time(),
        end=end.time(),
        calendar_event_id=event.get("id"),
        calendar_link=event.get("htmlLink"),
        attendees=[g["email"] for g in event.get("attendees", []) if g.get("email") and not g.get("organizer")],
    )
    fields["meeting_link"] = meet_link(event)
    try:
        return Appointment.model_validate(_nest(fields))
    except ValidationError:
        return None


def parse_description(text: str) -> dict[str, str]:
    """'Label: value' lines -> {dotted field path: value}. Unknown lines are ignored."""
    fields: dict[str, str] = {}
    for line in text.replace("\r", "").split("\n"):
        label, sep, value = line.partition(":")
        path = LABELS.get(label.strip())
        if sep and path and value.strip():
            fields[path] = value.strip()
    return fields


def _event_time(when: dict[str, Any] | None, tz: ZoneInfo) -> dt.datetime | None:
    if not when or "dateTime" not in when:
        return None
    moment = dt.datetime.fromisoformat(when["dateTime"])
    return moment.astimezone(tz) if moment.tzinfo else moment


def _nest(flat: dict[str, Any]) -> dict[str, Any]:
    nested: dict[str, Any] = {}
    for path, value in flat.items():
        head, _, tail = path.partition(".")
        if tail:
            nested.setdefault(head, {})[tail] = value
            continue
        nested[head] = value
    return nested


def _get(values: dict[str, Any], path: str) -> Any:
    head, _, tail = path.partition(".")
    return values.get(head, {}).get(tail) if tail else values.get(head)


def _one_line(value: str) -> str:
    return " ".join(value.split())
