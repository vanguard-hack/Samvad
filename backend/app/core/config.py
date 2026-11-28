"""Settings read from the environment (Railway variables, or backend/.env locally)."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    """Minimal .env loader for local development; real env vars always win, then .env.local, then .env."""
    for path in (BACKEND_DIR / ".env.local", BACKEND_DIR / ".env"):
        if path.is_file():
            _load_env_file(path)


def _load_env_file(path: Path) -> None:
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
    # Voice assistant (Claude on Amazon Bedrock). Credentials come from the standard
    # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY variables, read by boto3.
    bedrock_model: str = ""
    aws_region: str = ""
    # Samvad agent: Claude (the Bedrock settings above) with the Wispr Flow MCP tools.
    # Wispr Flow signs in with OAuth (no API key); tokens are cached in wispr_token_file.
    wispr_mcp_url: str = "https://api.wisprflow.ai/connect/mcp"  # no trailing slash
    wispr_oauth_scope: str = "openid offline_access"
    wispr_token_file: Path = BACKEND_DIR / ".wispr_oauth.json"
    # Optional secret (the token file's JSON, or base64 of it) that seeds wispr_token_file
    # while that file has no tokens, e.g. on Railway where neither repo nor image has it.
    wispr_oauth_json: str = ""
    # Where browsers reach this API; the OAuth redirect is <this>/api/samvad-agent/oauth/callback.
    public_base_url: str = "http://localhost:8000"
    wispr_auth_timeout_s: int = 600
    wispr_open_browser: bool = False  # open the sign-in page on the server's own desktop (local dev only)
    # Appointments: Google Calendar through a service account (no user OAuth). The key is a
    # secret (the JSON key file's contents, or base64 of it); the calendar is shared with
    # the service account's email.
    google_service_account_json: str = ""
    google_calendar_id: str = ""
    google_calendar_timezone: str = "Asia/Kolkata"

    @property
    def wispr_redirect_uri(self) -> str:
        return f"{self.public_base_url}/api/samvad-agent/oauth/callback"


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
        # Accept LiteLLM-style ids ("bedrock/eu.anthropic...") as well as plain Bedrock ids.
        bedrock_model=env("BEDROCK_MODEL_ID", "").removeprefix("bedrock/"),
        aws_region=env("AWS_REGION") or env("AWS_REGION_NAME") or env("AWS_DEFAULT_REGION", ""),
        wispr_mcp_url=env("WISPR_MCP_URL", "https://api.wisprflow.ai/connect/mcp").rstrip("/"),
        wispr_oauth_scope=env("WISPR_OAUTH_SCOPE", "openid offline_access"),
        # A relative path is relative to backend/; an absolute one (a Railway volume) is used as is.
        wispr_token_file=BACKEND_DIR / env("WISPR_TOKEN_FILE", ".wispr_oauth.json"),
        wispr_oauth_json=env("WISPR_OAUTH_JSON", "").strip(),
        public_base_url=env("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
        wispr_auth_timeout_s=int(env("WISPR_AUTH_TIMEOUT_S", "600")),
        wispr_open_browser=env("WISPR_OPEN_BROWSER", "false").lower() == "true",
        google_service_account_json=env("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip(),
        # Unset: the service account's own calendar ("primary").
        google_calendar_id=env("GOOGLE_CALENDAR_ID", "").strip() or "primary",
        google_calendar_timezone=env("GOOGLE_CALENDAR_TIMEZONE", "Asia/Kolkata").strip(),
    )
