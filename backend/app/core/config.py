"""Settings read from the environment (Railway variables, or backend/.env locally)."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env loader for local development; real env vars always win."""
    path = Path(__file__).resolve().parents[2] / ".env"  # backend/.env
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    sarvam_api_key: str
    supabase_url: str
    supabase_publishable_key: str
    # Comma-separated browser origins allowed to call the API directly (local dev).
    # In production the frontend and API share one origin behind Caddy.
    cors_origins: tuple[str, ...]
    # Samvad's voice: a female bulbul:v3 speaker that covers all 11 TTS languages.
    tts_model: str = "bulbul:v3"
    tts_speaker: str = "ishita"
    stt_model: str = "saaras:v4"
    # Pay-as-you-go allows 20 concurrent streaming sockets per account; stay under it.
    max_streams: int = 15


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()
    env = os.environ.get
    return Settings(
        sarvam_api_key=env("SARVAM_API_KEY", ""),
        # The frontend's build variables are reused so Railway needs no duplicates.
        supabase_url=(env("SUPABASE_URL") or env("VITE_SUPABASE_URL", "")).rstrip("/"),
        supabase_publishable_key=env("SUPABASE_PUBLISHABLE_KEY") or env("VITE_SUPABASE_PUBLISHABLE_KEY", ""),
        cors_origins=tuple(o.strip() for o in env("CORS_ORIGINS", "").split(",") if o.strip()),
        tts_speaker=env("SARVAM_TTS_SPEAKER", "ishita"),
    )
