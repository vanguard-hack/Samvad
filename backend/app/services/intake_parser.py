"""Turns a patient's spoken answer into a form value (pure functions, unit-tested).

Returns "" for an explicit 'no / none' and None when not understood, so the
caller can ask again.
"""

import re

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
