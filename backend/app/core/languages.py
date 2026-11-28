"""Map Samvad's language codes (frontend/src/i18n/languages.ts) to Sarvam's."""

# Speech-to-text (REST) — all 22 scheduled languages + English.
STT_REST = {
    "en": "en-IN", "hi": "hi-IN", "bn": "bn-IN", "te": "te-IN", "mr": "mr-IN",
    "ta": "ta-IN", "ur": "ur-IN", "gu": "gu-IN", "kn": "kn-IN", "or": "od-IN",
    "ml": "ml-IN", "pa": "pa-IN", "as": "as-IN", "mai": "mai-IN", "sat": "sat-IN",
    "ks": "ks-IN", "ne": "ne-IN", "gom": "kok-IN", "sd": "sd-IN", "doi": "doi-IN",
    "mni": "mni-IN", "brx": "brx-IN", "sa": "sa-IN",
}

# The realtime socket spells Odia "or-IN" (REST uses "od-IN").
STT_STREAM = {**STT_REST, "or": "or-IN"}

# Text-to-speech covers 11 languages: exactly the ones marked `voice: true` in
# the frontend. Others must never be spoken (picture mode + human interpreter).
TTS = {k: STT_REST[k] for k in ("en", "hi", "bn", "te", "mr", "ta", "gu", "kn", "or", "ml", "pa")}

# Translation (sarvam-translate:v1 supports all 22 + English).
TRANSLATE = STT_REST


def stt_rest_code(code: str | None) -> str:
    """'auto' or unknown codes fall back to Sarvam's language detection."""
    return STT_REST.get(code or "", "unknown")


def stt_stream_code(code: str | None) -> str:
    return STT_STREAM.get(code or "", "auto")
