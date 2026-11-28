"""Global voice assistant: Claude (on Amazon Bedrock) that can use Samvad for the doctor.

The browser sends what the doctor said (already transcribed by Sarvam), which
page is open and a text snapshot of it. Claude answers using tools:

- data tools run HERE, against Supabase with the doctor's own access token, so
  row-level security limits them to that doctor's patients;
- page tools (navigate, filter the queue, start a voice registration) are
  returned to the browser as `actions` to carry out.

Saving: by the user's explicit decision (2026-11-28) the assistant may save on
its own (Critical Rule 1 override). Every save is marked `last_event =
'assistant'` and the reply says what was saved. Unchanged: patients who decline
consent are never stored (Rule 3), and the assistant never prescribes,
diagnoses or sets risk unless the doctor tells it to (Rule 4).
Nothing is logged or stored here.
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from anthropic import APIConnectionError, APIStatusError, AsyncAnthropicBedrock, RateLimitError
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from . import languages
from .auth import current_session
from .config import get_settings

log = logging.getLogger("samvad.assistant")
router = APIRouter(prefix="/api")

IST = timezone(timedelta(hours=5, minutes=30))
MAX_STEPS = 8
PATIENT_COLUMNS = (
    "id,patient_number,full_name,age,sex,phone,language,can_read,companion,allergies,conditions,medicines,"
    "consent,patient_words,clinic,reason,priority,queue_status,last_event,last_event_at,due_at,visits,last_visit,created_at"
)
LIST_COLUMNS = "id,patient_number,full_name,age,sex,language,clinic,reason,priority,queue_status,last_event,last_event_at,due_at"
CONDITIONS = ["diabetes", "hypertension", "asthma", "heart", "thyroid", "kidney"]
STATUSES = ["needs_action", "in_progress", "waiting", "completed"]
PRIORITIES = ["high", "medium", "low", "none"]
PAGES = ["patients", "interpreter", "profile", "patient"]

_client: AsyncAnthropicBedrock | None = None


def bedrock() -> AsyncAnthropicBedrock:
    global _client
    s = get_settings()
    if not s.bedrock_model or not s.aws_region:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Assistant is not configured")
    if _client is None:
        _client = AsyncAnthropicBedrock(aws_region=s.aws_region, timeout=60, max_retries=2)
    return _client


SYSTEM_PROMPT = f"""You are the voice assistant inside Samvad, a medical interpreter and patient-records web app used by doctors in Indian clinics. The doctor talks to you by voice; your replies are spoken aloud, so keep them short (one to three sentences), natural, and free of markdown, lists or symbols.

## What the app has
- Patients page (the home screen, "/"): a prioritized work queue with tabs needs_action, in_progress, waiting, completed; filters for priority (high, medium, low, none = not triaged) and clinic; search by name, ID, reason or clinic. Patient IDs look like SMV-1003.
- Patient record page ("/patients/<id>"): details, language, health (allergies, conditions, medicines), queue details, and the voice-intake recording.
- New patient: a dialog where Samvad asks the PATIENT the registration questions aloud in their language and fills the form.
- Interpreter page ("/interpreter"): live transcription and read-aloud.
- Profile page ("/profile"): the doctor's name.

## How to act
- Use tools to look things up; never invent patient data. If several patients match, say so and ask which one.
- To show something, use the page tools (navigate_to, show_queue). When the doctor asks to "pull up" or "open" a patient, find them, open their record with navigate_to, and give a one-sentence summary.
- To register a patient who is present, call start_patient_registration with the patient's language; Samvad then asks the patient the questions itself and saves the patient when finished. Only use create_patient when the doctor dictates the details directly.
- You may save changes yourself (create patients, update status, reason, clinic, due time). After saving, say exactly what you saved.
- Change a patient's priority (risk) only when the doctor explicitly tells you to. Never decide risk yourself.
- Never diagnose, prescribe, or suggest medicines or doses. If asked, say that clinical decisions are the doctor's, and offer to open the relevant record.
- A patient is stored only if they gave recording consent. If the doctor says the patient declined, do not create them; explain that patients who decline are not saved.
- Allowed conditions: {", ".join(CONDITIONS)}. Statuses: {", ".join(STATUSES)}.
- Reply in the language the doctor spoke (given with each message). Keep patient names and IDs as written.
"""


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


# ── Supabase as the doctor ───────────────────────────────────────────────────
class Db:
    def __init__(self, token: str):
        s = get_settings()
        self.base = f"{s.supabase_url}/rest/v1/patients"
        self.headers = {"apikey": s.supabase_publishable_key, "Authorization": f"Bearer {token}"}

    async def request(self, method: str, params: dict | None = None, body: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.request(method, self.base, params=params, json=body, headers=headers)
        if r.status_code >= 400:
            raise ToolError(f"Database error ({r.status_code}). {r.json().get('message', '') if r.content else ''}".strip())
        return r.json() if r.content else None


class ToolError(Exception):
    pass


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


# ── Endpoint ─────────────────────────────────────────────────────────────────
class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=4000)


class AssistantIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = "en"
    path: str = Field(default="/", max_length=200)
    page_text: str = Field(default="", max_length=6000)
    history: list[Turn] = Field(default_factory=list, max_length=20)


@router.post("/assistant")
async def assistant(body: AssistantIn, session: tuple[str, str] = Depends(current_session)) -> dict:
    _user, token = session
    s = get_settings()
    client = bedrock()
    db = Db(token)

    lang_name = {"en": "English", "hi": "Hindi", "bn": "Bengali", "te": "Telugu", "mr": "Marathi", "ta": "Tamil", "gu": "Gujarati",
                 "kn": "Kannada", "or": "Odia", "ml": "Malayalam", "pa": "Punjabi"}.get(body.language, "English")
    now = datetime.now(IST).strftime("%A %d %B %Y, %H:%M IST")
    # Volatile context goes in the user turn, after the cached tools + system prefix.
    context = (
        f"<context>\nNow: {now}\nOpen page: {body.path}\nDoctor spoke in: {lang_name} (reply in {lang_name})\n"
        f"<page_text>\n{body.page_text}\n</page_text>\n</context>\n\n{body.text}"
    )
    messages: list[dict] = [{"role": t.role, "content": t.text} for t in body.history if t.text.strip()]
    # The API needs alternating turns starting with the user.
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    messages.append({"role": "user", "content": context})

    actions: list[dict] = []
    reply = ""
    ended = False
    try:
        for _ in range(MAX_STEPS):
            response = await client.messages.create(
                model=s.bedrock_model,
                max_tokens=2000,
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=TOOLS,
                thinking={"type": "adaptive"},
                output_config={"effort": "low"},  # spoken back-and-forth: keep it quick
                messages=messages,
            )
            if response.stop_reason == "refusal":
                reply = "Sorry, I can't help with that."
                break
            texts = [b.text for b in response.content if b.type == "text"]
            calls = [b for b in response.content if b.type == "tool_use"]
            if texts:
                reply = " ".join(t.strip() for t in texts if t.strip())
            if response.stop_reason != "tool_use" or not calls:
                break

            messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in response.content]})
            results = []
            for call in calls:
                try:
                    if call.name in UI_TOOLS:
                        action, result = ui_action(call.name, call.input)
                        actions.append(action)
                        ended = ended or action["type"] == "start_registration"
                    else:
                        result = await run_data_tool(db, call.name, call.input)
                        if isinstance(result, dict) and result.get("saved"):
                            actions.append({"type": "refresh"})
                    results.append({"type": "tool_result", "tool_use_id": call.id, "content": json.dumps(result, default=str)})
                except ToolError as exc:
                    results.append({"type": "tool_result", "tool_use_id": call.id, "content": str(exc), "is_error": True})
            messages.append({"role": "user", "content": results})
    except RateLimitError:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Assistant is busy, try again in a moment") from None
    except APIStatusError as exc:
        log.warning("Bedrock error %s", exc.status_code)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Assistant error") from None
    except APIConnectionError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach the assistant") from None

    return {"reply": reply or "Done.", "actions": actions, "ended": ended}
