"""Voice intake for the New patient form.

Samvad asks each question aloud in the patient's language (translated from the
English below, spoken by the female TTS voice), the patient answers, and the
answer is turned into a value for the matching form field.

Speed matters more than ceremony (user decision, 2026-11-28): questions are
short, their audio is cached, and each answer is read by Claude, which fixes
speech-recognition slips ("Doro 650" -> "Dolo 650"), translates and extracts
the value in one step. A read-back happens only when Claude is NOT confident
(this relaxes Critical Rule 5 for intake, at the user's request). Without
Claude configured, the older translate + rules parser is used and the usual
read-backs apply.

Safety:
- Every value is a DRAFT the doctor reviews before "Add patient" (Rule 1).
- The patient's words are returned verbatim beside the English (Rule 6).
- Nothing is stored or logged here.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sarvamai.core.api_error import ApiError

from . import languages
from .auth import current_user
from .config import get_settings

router = APIRouter(prefix="/api/intake")

# Short and crisp on purpose: every extra word is time the patient waits.
PROMPTS: dict[str, str] = {
    "name": "Your full name?",
    "age": "Your age?",
    "sex": "Male, female or other?",
    "phone": "Mobile number?",
    "allergies": "Any allergies?",
    "conditions": "Diabetes, BP, asthma, heart, thyroid or kidney problem?",
    "medicines": "Medicines you take now?",
    "consent": "Can we save today's recording? Yes or no?",
    "confirm": "{value}, correct?",
    "retry": "Sorry, once more?",
    "done": "Thank you.",
}

# Fallback parser only (no Claude): fields read back before use (Critical Rule 5).
CONFIRM_FIELDS = {"age", "phone", "allergies", "medicines", "consent"}

CONDITION_WORDS = {
    "diabetes": ("diabet", "sugar"),
    "hypertension": ("blood pressure", "hypertension", " bp", "bp "),
    "asthma": ("asthma", "breathing", "wheez"),
    "heart": ("heart", "cardiac"),
    "thyroid": ("thyroid",),
    "kidney": ("kidney", "renal"),
}

NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}

_YES = re.compile(r"\b(yes|yeah|yep|ok|okay|sure|correct|right|agree|of course|haan|ha|han|ji)\b")
_NO = re.compile(r"\b(no|not|nope|none|nothing|never|don't|do not|nahi|nahin|wrong|incorrect)\b")

# Translated fixed prompts never change; cache them per language (no patient data).
_prompt_cache: dict[tuple[str, str], str] = {}
# ...and so is their spoken audio, which makes each question start almost instantly.
_audio_cache: dict[tuple[str, str], str] = {}


def _sarvam():
    from .main import sarvam  # late import: avoids a circular import

    return sarvam()


def _upstream(exc: ApiError) -> HTTPException:
    from .main import upstream_error

    return upstream_error(exc)


async def to_language(text: str, lang: str) -> str:
    if lang == "en":
        return text
    r = await _sarvam().text.translate(
        input=text,
        source_language_code="en-IN",
        target_language_code=languages.TRANSLATE[lang],
        model="sarvam-translate:v1",
    )
    return r.translated_text


async def to_english(text: str, lang: str) -> str:
    if lang == "en":
        return text
    r = await _sarvam().text.translate(
        input=text,
        source_language_code=languages.TRANSLATE[lang],
        target_language_code="en-IN",
        model="sarvam-translate:v1",
    )
    return r.translated_text


# ── Parsing (pure functions, unit-tested) ────────────────────────────────────
def yes_no(english: str) -> bool | None:
    t = f" {english.lower()} "
    no, yes = bool(_NO.search(t)), bool(_YES.search(t))
    if no and not yes:
        return False
    if yes and not no:
        return True
    return None


def parse_number(text: str) -> int | None:
    m = re.search(r"\d{1,3}", text)
    if m:
        return int(m.group())
    total, seen = 0, False
    for word in re.findall(r"[a-z]+", text.lower()):
        if word in NUMBER_WORDS:
            total += NUMBER_WORDS[word]
            seen = True
        elif word == "hundred" and seen:
            total *= 100
    return total if seen else None


def parse(field: str, original: str, english: str) -> str | list[str] | None:
    """Returns the form value, "" for an explicit 'no / none', or None if not understood."""
    e = english.strip()
    low = f" {e.lower()} "
    if field == "age":
        n = parse_number(original) if re.search(r"\d", original) else parse_number(e)
        return str(n) if n is not None and 0 <= n <= 120 else None
    if field == "sex":
        if re.search(r"\b(female|woman|lady|girl|she)\b", low):
            return "F"
        if re.search(r"\b(male|man|gent|boy|he)\b", low):
            return "M"
        if re.search(r"\b(other|transgender|non-binary|third)\b", low):
            return "O"
        return None
    if field == "phone":
        digits = re.sub(r"\D", "", original) or re.sub(r"\D", "", e)
        digits = digits[-10:] if len(digits) >= 10 else digits
        if re.fullmatch(r"[6-9]\d{9}", digits):
            return digits
        return "" if yes_no(e) is False else None
    if field in ("allergies", "medicines"):
        if yes_no(e) is False and len(e.split()) <= 4:
            return ""
        return e or None
    if field == "conditions":
        found = [key for key, words in CONDITION_WORDS.items() if any(w in low for w in words)]
        if found:
            return found
        return [] if yes_no(e) is False else None
    if field == "consent":
        yn = yes_no(e)
        return None if yn is None else ("given" if yn else "declined")
    if field == "confirm":
        yn = yes_no(e)
        return None if yn is None else ("yes" if yn else "no")
    return e or None


# ── Endpoints ────────────────────────────────────────────────────────────────
class PromptIn(BaseModel):
    key: str
    language: str
    # Read-back text for the "confirm" prompt, in the patient's language or digits.
    value: str | None = Field(default=None, max_length=300)


@router.post("/prompt")
async def prompt(body: PromptIn, _user: str = Depends(current_user)) -> dict:
    """The question as text (patient's language + English) and spoken WAV (base64)."""
    if body.key not in PROMPTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown question")
    code = languages.TTS.get(body.language)
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No voice for this language")
    english = PROMPTS[body.key]
    s = get_settings()
    try:
        if body.key == "confirm":
            # Translate the frame with a placeholder, then insert the patient's own words
            # untouched, so the read-back repeats exactly what was heard.
            frame = await to_language(english.replace("{value}", "XYZ"), body.language)
            text = frame.replace("XYZ", body.value or "") if "XYZ" in frame else f"{body.value}. {frame}"
            english = english.replace("{value}", body.value or "")
        else:
            cache_key = (body.key, body.language)
            if cache_key not in _prompt_cache:
                _prompt_cache[cache_key] = await to_language(english, body.language)
            text = _prompt_cache[cache_key]
            if cache_key in _audio_cache:
                return {"text": text, "english": english, "audio": _audio_cache[cache_key]}
        r = await _sarvam().text_to_speech.convert(
            text=text, language_code=code, model=s.tts_model, speaker=s.tts_speaker, pace=1.1, speech_sample_rate=22050
        )
    except ApiError as exc:
        raise _upstream(exc) from None
    if not r.audios:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service returned no audio")
    if body.key != "confirm":
        _audio_cache[(body.key, body.language)] = r.audios[0]
    return {"text": text, "english": english, "audio": r.audios[0]}


class ParseIn(BaseModel):
    field: str
    language: str
    text: str = Field(min_length=1, max_length=1000)


@router.post("/parse")
async def parse_answer(body: ParseIn, _user: str = Depends(current_user)) -> dict:
    """Turns the patient's spoken answer into a form value."""
    if body.field not in PROMPTS or body.language not in languages.TRANSLATE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad request")
    s = get_settings()
    if s.bedrock_model and s.aws_region:
        result = await claude_parse(body.field, body.language, body.text)
        if result is not None:
            return result
    # Fallback: Sarvam translation + rules, with the usual read-backs.
    try:
        english = await to_english(body.text, body.language)
        value: object
        if body.field == "name":
            # Names stay as spoken, written in English letters for the records.
            name = body.text.strip()
            if body.language != "en" and not re.search(r"[A-Za-z]", name):
                try:
                    r = await _sarvam().text.transliterate(
                        input=name, source_language_code=languages.TRANSLATE[body.language], target_language_code="en-IN"
                    )
                    name = r.transliterated_text
                except ApiError:
                    pass  # keep the native script; the doctor can retype it
            name = re.sub(r"^(my name is|i am|this is|name)\s+", "", name.strip(" .,"), flags=re.I)
            value = " ".join(w[:1].upper() + w[1:] for w in name.split()) or None
        else:
            value = parse(body.field, body.text, english)
    except ApiError as exc:
        raise _upstream(exc) from None
    return {"value": value, "english": english, "confirm": body.field in CONFIRM_FIELDS}


# ── Claude reads the answer ──────────────────────────────────────────────────
LANG_NAMES = {
    "en": "English", "hi": "Hindi", "bn": "Bengali", "te": "Telugu", "mr": "Marathi", "ta": "Tamil", "gu": "Gujarati",
    "kn": "Kannada", "or": "Odia", "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu", "as": "Assamese",
}

FIELD_RULES = {
    "name": "the person's full name in English (Latin) letters, Title Case, without phrases like 'my name is'",
    "age": "age in whole years as digits (0-120)",
    "sex": "F, M or O",
    "phone": "10-digit Indian mobile number (starts with 6-9), digits only; status none if they decline",
    "allergies": "allergies in English, comma-separated; status none if they have none",
    "conditions": "comma-separated keys from: diabetes, hypertension (BP), asthma, heart, thyroid, kidney; status none if none",
    "medicines": "medicines in English with strength/dose as said, correcting brand-name recognition errors; status none if none",
    "consent": "given or declined",
    "confirm": "yes or no (is the patient confirming the read-back?)",
}

PARSE_SYSTEM = """You fill ONE field of an Indian clinic's patient-registration form from the patient's spoken answer.
The answer comes from speech recognition and may contain recognition errors. Fix them using context: Indian names, common Indian medicine brands and generics (e.g. "Doro 650" -> "Dolo 650", "Telma 40", "Glycomet", "Thyronorm", "Pan 40", "Ecosprin"), numbers spoken as words, and code-mixed English.
Never invent information the patient did not say. Call the record_field tool exactly once.
Set confident=false only when you genuinely cannot tell what the patient meant or a key detail (a number, a drug name) is ambiguous; otherwise confident=true."""

PARSE_TOOL = {
    "name": "record_field",
    "description": "Record the value for the form field.",
    "input_schema": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "enum": ["ok", "none", "unclear"],
                "description": "ok = value given; none = patient said they have none / declined; unclear = cannot tell",
            },
            "value": {"type": "string", "description": "The value in the required format (empty for none/unclear)."},
            "english": {"type": "string", "description": "The answer in plain English, as corrected."},
            "confident": {"type": "boolean"},
        },
        "required": ["status", "value", "english", "confident"],
        "additionalProperties": False,
    },
}


def normalise(field: str, status_: str, value: str) -> str | list[str] | None:
    """Validates Claude's value for the field. "" / [] = explicit none, None = not usable."""
    if status_ == "unclear":
        return None
    if status_ == "none":
        if field == "conditions":
            return []
        return "" if field in ("phone", "allergies", "medicines") else None
    v = value.strip()
    if field == "age":
        return v if v.isdigit() and 0 <= int(v) <= 120 else None
    if field == "sex":
        return v.upper() if v.upper() in ("F", "M", "O") else None
    if field == "phone":
        digits = re.sub(r"\D", "", v)[-10:]
        return digits if re.fullmatch(r"[6-9]\d{9}", digits) else None
    if field == "conditions":
        keys = [c.strip().lower() for c in v.split(",")]
        keys = ["hypertension" if k in ("bp", "blood pressure") else k for k in keys]
        found = [k for k in CONDITION_WORDS if k in keys]
        return found or None
    yes_no_map = {"given": "yes", "yes": "yes", "declined": "no", "no": "no"}
    answer = yes_no_map.get(v.lower())
    if field == "consent":
        return None if answer is None else ("given" if answer == "yes" else "declined")
    if field == "confirm":
        return answer
    return v[:200] or None


async def claude_parse(field: str, language: str, text: str) -> dict | None:
    """One fast Claude call: correct, translate and extract. None if Claude is unavailable."""
    from anthropic import APIConnectionError, APIStatusError

    from .assistant import bedrock

    try:
        r = await bedrock().messages.create(
            model=get_settings().bedrock_model,
            max_tokens=400,
            system=[{"type": "text", "text": PARSE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            tools=[PARSE_TOOL],
            # Forced tool call and no extended thinking: this must be quick.
            tool_choice={"type": "tool", "name": "record_field"},
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Field: {field} ({FIELD_RULES[field]})\n"
                        f"Patient's language: {LANG_NAMES.get(language, language)}\n"
                        f"Transcribed answer: {text}"
                    ),
                }
            ],
        )
    except (APIStatusError, APIConnectionError, HTTPException):
        return None
    call = next((b for b in r.content if b.type == "tool_use"), None)
    if call is None:
        return None
    data = call.input
    value = normalise(field, str(data.get("status", "unclear")), str(data.get("value", "")))
    empty = value == "" or value == []
    return {
        "value": value,
        "english": str(data.get("english", "")),
        # Read back only when Claude isn't sure (never for the read-back answer itself).
        "confirm": field != "confirm" and value is not None and not empty and not bool(data.get("confident", True)),
    }
