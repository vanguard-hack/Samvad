"""Voice intake for the New patient form.

Samvad asks each question aloud in the patient's language (translated from the
English below, spoken by the female TTS voice), the patient answers, and the
answer is turned into a value for the matching form field.

Safety:
- Every value is a DRAFT: the doctor reviews the form and presses "Add patient"
  (Critical Rule 1).
- Numbers, allergies, medicines and yes/no answers are read back for
  confirmation before they are used (Critical Rule 5).
- The patient's words are returned verbatim beside the English (Critical Rule 6).
- Nothing is stored or logged here.
"""

import re

from fastapi import HTTPException, status
from sarvamai.core.api_error import ApiError

from app.core import languages
from app.core.config import get_settings
from app.core.sarvam import sarvam as _sarvam
from app.core.sarvam import upstream_error as _upstream
from app.services.intake_parser import parse

PROMPTS: dict[str, str] = {
    "name": "Hello. I will ask you a few questions to register you. What is your full name?",
    "age": "How old are you, in years?",
    "sex": "Are you female, male, or other?",
    "phone": "What is your mobile number? If you do not want to share it, say no.",
    "allergies": "Are you allergic to any medicine or food? If not, say no.",
    "conditions": (
        "Do you have any long-term illness, such as diabetes, high blood pressure, asthma, "
        "heart disease, thyroid or kidney disease? If not, say no."
    ),
    "medicines": "Which medicines are you taking now? If none, say no.",
    "consent": "May we save the recording and notes of today's visit? Please say yes or no.",
    "confirm": "You said: {value}. Is that correct? Please say yes or no.",
    "retry": "Sorry, I did not catch that. Please say it again.",
    "done": "Thank you. The doctor will now check your details.",
}

# Fields whose value is read back before use (Critical Rule 5).
CONFIRM_FIELDS = {"age", "phone", "allergies", "medicines", "consent"}

# Translated fixed prompts never change; cache them per language (no patient data).
_prompt_cache: dict[tuple[str, str], str] = {}


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
        r = await _sarvam().text_to_speech.convert(
            text=text, language_code=tts_code, model=s.tts_model, speaker=s.tts_speaker, pace=0.95, speech_sample_rate=22050
        )
    except ApiError as exc:
        raise _upstream(exc) from None
    if not r.audios:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service returned no audio")
    return {"text": text, "english": english, "audio": r.audios[0]}


async def interpret_answer(*, field: str, language: str, text: str) -> dict:
    """`field` must be in PROMPTS and `language` in languages.TRANSLATE (checked by the endpoint)."""
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
