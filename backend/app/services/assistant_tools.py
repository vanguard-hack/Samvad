"""The voice assistant's tools: data tools run here against Supabase, page tools become browser actions."""

import re
from datetime import datetime, timezone
from typing import Any

from app.core import languages
from app.core.exceptions import ToolError
from app.repositories.patient_repository import LIST_COLUMNS, PATIENT_COLUMNS, Db

CONDITIONS = ["diabetes", "hypertension", "asthma", "heart", "thyroid", "kidney"]
STATUSES = ["needs_action", "in_progress", "waiting", "completed"]
PRIORITIES = ["high", "medium", "low", "none"]
PAGES = ["patients", "interpreter", "profile", "patient"]


def _tool(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


TOOLS: list[dict] = [
    _tool(
        "search_patients",
        "Find the doctor's patients by name, patient ID (e.g. SMV-1003 or 1003), reason or clinic, and/or filter by queue status, priority or clinic. Returns a short list.",
        {
            "query": {"type": "string", "description": "Name, ID, reason or clinic text. Omit to list."},
            "status": {"type": "string", "enum": STATUSES},
            "priority": {"type": "string", "enum": PRIORITIES},
            "clinic": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
        },
    ),
    _tool(
        "get_patient",
        "Get the full record of one patient (details, language, health, queue info, the patient's own spoken answers).",
        {"patient_id": {"type": "string", "description": "The patient's uuid from search_patients."}},
        ["patient_id"],
    ),
    _tool(
        "update_patient",
        "Save changes to a patient's queue details. Only include fields the doctor asked to change. Priority only on the doctor's explicit instruction.",
        {
            "patient_id": {"type": "string"},
            "status": {"type": "string", "enum": STATUSES},
            "priority": {"type": "string", "enum": PRIORITIES, "description": "none = not triaged"},
            "reason": {"type": "string", "maxLength": 200},
            "clinic": {"type": "string", "maxLength": 80},
            "due_at": {"type": "string", "description": "ISO 8601 date-time with timezone, e.g. 2026-11-28T15:30:00+05:30. Empty string clears it."},
        },
        ["patient_id"],
    ),
    _tool(
        "create_patient",
        "Save a new patient from details the doctor dictates. Requires that the patient gave recording consent.",
        {
            "full_name": {"type": "string", "maxLength": 80},
            "age": {"type": "integer", "minimum": 0, "maximum": 120},
            "sex": {"type": "string", "enum": ["F", "M", "O"]},
            "language": {"type": "string", "enum": sorted(languages.STT_REST)},
            "phone": {"type": "string", "description": "10-digit Indian mobile number, optional"},
            "allergies": {"type": "string"},
            "conditions": {"type": "array", "items": {"type": "string", "enum": CONDITIONS}},
            "medicines": {"type": "string"},
            "reason": {"type": "string", "maxLength": 200},
            "clinic": {"type": "string", "maxLength": 80},
            "consent_given": {"type": "boolean", "description": "True only if the patient agreed to recording and storage."},
        },
        ["full_name", "age", "sex", "language", "consent_given"],
    ),
    _tool(
        "navigate_to",
        "Open a page in the app on the doctor's screen.",
        {
            "page": {"type": "string", "enum": PAGES, "description": "patient = one patient's record (needs patient_id)"},
            "patient_id": {"type": "string"},
        },
        ["page"],
    ),
    _tool(
        "show_queue",
        "Open the patients queue on screen with a tab, filters or search applied.",
        {
            "status": {"type": "string", "enum": STATUSES},
            "priority": {"type": "string", "enum": [*PRIORITIES, "all"]},
            "clinic": {"type": "string", "description": "Clinic name, or 'all'"},
            "search": {"type": "string"},
        },
    ),
    _tool(
        "start_patient_registration",
        "Open the New patient form and start voice questions for the patient in their language. Samvad asks the patient and saves when done. Ends this assistant conversation.",
        {"language": {"type": "string", "enum": sorted(languages.TTS), "description": "Patient's language (voice-supported only)"}},
        ["language"],
    ),
]
# The last tool definition carries a cache breakpoint: tools + system are stable.
TOOLS[-1] = {**TOOLS[-1], "cache_control": {"type": "ephemeral"}}

UI_TOOLS = {"navigate_to", "show_queue", "start_patient_registration"}


def _code(p: dict) -> str:
    return f"SMV-{p['patient_number']}"


def _summary(p: dict) -> dict:
    return {
        "patient_id": p["id"],
        "code": _code(p),
        "name": p["full_name"],
        "age": p["age"],
        "sex": p["sex"],
        "language": p["language"],
        "clinic": p.get("clinic"),
        "reason": p.get("reason"),
        "priority": p.get("priority") or "none",
        "status": p["queue_status"],
        "due_at": p.get("due_at"),
        "last_event": p.get("last_event"),
    }


def _uuid(value: str) -> str:
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", value or ""):
        raise ToolError("patient_id must be the uuid returned by search_patients")
    return value


async def run_data_tool(db: Db, name: str, args: dict) -> Any:
    if name == "search_patients":
        params: dict[str, str] = {"select": LIST_COLUMNS, "order": "last_event_at.desc", "limit": str(args.get("limit") or 10)}
        if args.get("status"):
            params["queue_status"] = f"eq.{args['status']}"
        if args.get("priority"):
            params["priority"] = "is.null" if args["priority"] == "none" else f"eq.{args['priority']}"
        if args.get("clinic"):
            params["clinic"] = f"ilike.*{args['clinic']}*"
        q = (args.get("query") or "").strip()
        if q:
            number = re.sub(r"\D", "", q)
            safe = re.sub(r"[,()*]", " ", q)
            ors = [f"full_name.ilike.*{safe}*", f"reason.ilike.*{safe}*", f"clinic.ilike.*{safe}*"]
            if number:
                ors.append(f"patient_number.eq.{number}")
            params["or"] = f"({','.join(ors)})"
        rows = await db.request("GET", params)
        return {"count": len(rows), "patients": [_summary(p) for p in rows]}

    if name == "get_patient":
        rows = await db.request("GET", {"select": PATIENT_COLUMNS, "id": f"eq.{_uuid(args['patient_id'])}"})
        if not rows:
            raise ToolError("No such patient")
        p = rows[0]
        return {**_summary(p), **{k: p[k] for k in ("phone", "can_read", "companion", "allergies", "conditions", "medicines", "patient_words", "visits", "last_visit", "created_at")}}

    if name == "update_patient":
        patch: dict[str, Any] = {}
        if "status" in args:
            patch["queue_status"] = args["status"]
        if "priority" in args:
            patch["priority"] = None if args["priority"] == "none" else args["priority"]
        for key in ("reason", "clinic"):
            if key in args:
                patch[key] = args[key].strip() or None
        if "due_at" in args:
            patch["due_at"] = args["due_at"] or None
        if not patch:
            raise ToolError("Nothing to change")
        patch |= {"last_event": "assistant", "last_event_at": datetime.now(timezone.utc).isoformat()}
        rows = await db.request(
            "PATCH", {"id": f"eq.{_uuid(args['patient_id'])}", "select": LIST_COLUMNS}, patch, prefer="return=representation"
        )
        if not rows:
            raise ToolError("No such patient")
        return {"saved": True, "patient": _summary(rows[0])}

    if name == "create_patient":
        if not args.get("consent_given"):
            # Critical Rule 3: never store a patient who declined.
            raise ToolError("Not saved: the patient has not given recording consent, and such patients are never stored.")
        phone = re.sub(r"\D", "", args.get("phone") or "")[-10:] or None
        if phone and not re.fullmatch(r"[6-9]\d{9}", phone):
            raise ToolError("Phone must be a 10-digit Indian mobile number")
        row = {
            "full_name": args["full_name"].strip(),
            "age": args["age"],
            "sex": args["sex"],
            "language": args["language"],
            "phone": phone,
            "allergies": (args.get("allergies") or "").strip() or None,
            "conditions": args.get("conditions") or [],
            "medicines": (args.get("medicines") or "").strip() or None,
            "reason": (args.get("reason") or "").strip() or None,
            "clinic": (args.get("clinic") or "").strip() or None,
            "consent": "given",
            "last_event": "assistant",
        }
        rows = await db.request("POST", {"select": LIST_COLUMNS}, row, prefer="return=representation")
        return {"saved": True, "patient": _summary(rows[0])}

    raise ToolError(f"Unknown tool {name}")


def ui_action(name: str, args: dict) -> tuple[dict, str]:
    """A page tool becomes an action for the browser, plus the result Claude sees."""
    if name == "navigate_to":
        if args.get("page") == "patient" and not args.get("patient_id"):
            raise ToolError("patient_id is required for page=patient")
        return {"type": "navigate", **args}, "Opened on the doctor's screen."
    if name == "show_queue":
        return {"type": "show_queue", **args}, "The queue is shown on screen with those filters."
    if name == "start_patient_registration":
        return (
            {"type": "start_registration", "language": args["language"]},
            "The New patient form is open and Samvad is now asking the patient the questions; it saves when finished. Tell the doctor briefly and stop.",
        )
    raise ToolError(f"Unknown tool {name}")
