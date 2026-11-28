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

from fastapi import HTTPException, status
from sarvamai.core.api_error import ApiError

from app.core import languages
from app.core.config import get_settings
from app.core.sarvam import sarvam as _sarvam
from app.core.sarvam import upstream_error as _upstream
from app.services.intake_parser import normalise, parse

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

# Translated fixed prompts never change; cache them per language (no patient data).
_prompt_cache: dict[tuple[str, str], str] = {}
# ...and so is their spoken audio, which makes each question start almost instantly.
_audio_cache: dict[tuple[str, str], str] = {}


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


async def build_prompt(*, key: str, language: str, tts_code: str, value: str | None) -> dict:
    """The question as text (patient's language + English) and spoken WAV (base64).

    `key` must be in PROMPTS and `tts_code` is the Sarvam TTS code for `language`
    (both checked by the endpoint).
    """
    english = PROMPTS[key]
    s = get_settings()
    try:
        if key == "confirm":
            # Translate the frame with a placeholder, then insert the patient's own words
            # untouched, so the read-back repeats exactly what was heard.
            frame = await to_language(english.replace("{value}", "XYZ"), language)
            text = frame.replace("XYZ", value or "") if "XYZ" in frame else f"{value}. {frame}"
            english = english.replace("{value}", value or "")
        else:
            cache_key = (key, language)
            if cache_key not in _prompt_cache:
                _prompt_cache[cache_key] = await to_language(english, language)
            text = _prompt_cache[cache_key]
            if cache_key in _audio_cache:
                return {"text": text, "english": english, "audio": _audio_cache[cache_key]}
        r = await _sarvam().text_to_speech.convert(
            text=text, language_code=tts_code, model=s.tts_model, speaker=s.tts_speaker, pace=1.1, speech_sample_rate=22050
        )
    except ApiError as exc:
        raise _upstream(exc) from None
    if not r.audios:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service returned no audio")
    if key != "confirm":
        _audio_cache[(key, language)] = r.audios[0]
    return {"text": text, "english": english, "audio": r.audios[0]}


async def interpret_answer(*, field: str, language: str, text: str) -> dict:
    """`field` must be in PROMPTS and `language` in languages.TRANSLATE (checked by the endpoint)."""
    s = get_settings()
    if s.bedrock_model and s.aws_region:
        result = await claude_parse(field, language, text)
        if result is not None:
            return result
    # Fallback: Sarvam translation + rules, with the usual read-backs.
    try:
        english = await to_english(text, language)
        value: object
        if field == "name":
            # Names stay as spoken, written in English letters for the records.
            name = text.strip()
            if language != "en" and not re.search(r"[A-Za-z]", name):
                try:
                    r = await _sarvam().text.transliterate(
                        input=name, source_language_code=languages.TRANSLATE[language], target_language_code="en-IN"
                    )
                    name = r.transliterated_text
                except ApiError:
                    pass  # keep the native script; the doctor can retype it
            name = re.sub(r"^(my name is|i am|this is|name)\s+", "", name.strip(" .,"), flags=re.I)
            value = " ".join(w[:1].upper() + w[1:] for w in name.split()) or None
        else:
            value = parse(field, text, english)
    except ApiError as exc:
        raise _upstream(exc) from None
    return {"value": value, "english": english, "confirm": field in CONFIRM_FIELDS}


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


async def claude_parse(field: str, language: str, text: str) -> dict | None:
    """One fast Claude call: correct, translate and extract. None if Claude is unavailable."""
    from anthropic import APIConnectionError, APIStatusError

    from app.core.bedrock import bedrock

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
