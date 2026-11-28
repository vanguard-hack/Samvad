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
from datetime import datetime, timedelta, timezone

from anthropic import APIConnectionError, APIStatusError, RateLimitError
from fastapi import HTTPException, status

from app.core.bedrock import bedrock
from app.core.config import get_settings
from app.core.exceptions import ToolError
from app.repositories.patient_repository import Db
from app.schemas.assistant import AssistantIn
from app.services.assistant_tools import CONDITIONS, STATUSES, TOOLS, UI_TOOLS, run_data_tool, ui_action

log = logging.getLogger("samvad.assistant")

IST = timezone(timedelta(hours=5, minutes=30))
MAX_STEPS = 8

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


async def run_assistant(body: AssistantIn, token: str) -> dict:
    """Runs Claude with tools for one doctor turn: {"reply", "actions", "ended"}."""
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
