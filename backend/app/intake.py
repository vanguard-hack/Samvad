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

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sarvamai.core.api_error import ApiError

from . import languages
from .auth import current_user
from .config import get_settings

router = APIRouter(prefix="/api/intake")

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
        r = await _sarvam().text_to_speech.convert(
            text=text, language_code=code, model=s.tts_model, speaker=s.tts_speaker, pace=0.95, speech_sample_rate=22050
        )
    except ApiError as exc:
        raise _upstream(exc) from None
    if not r.audios:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech service returned no audio")
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
