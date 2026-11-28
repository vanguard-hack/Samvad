"""Samvad API: a thin, authenticated proxy to Sarvam AI speech and translation.

The Sarvam key never leaves the server. Audio and text pass straight through:
nothing is stored or logged here (Critical Rule 3), and Sarvam's workspace is
set to 0-day retention.

Endpoints (all under /api, all need a Supabase access token except health):
  POST /api/stt          short recording (≤ 30 s) → transcript
  WS   /api/stt/stream   live 16 kHz PCM audio → partial + final transcripts
  POST /api/tts          text → spoken WAV in Samvad's female voice
  POST /api/translate    text → text between Indian languages
  POST /api/intake/*     voice-guided New patient questions (see services/intake_service.py)
  POST /api/assistant    Ctrl+Space voice assistant (Claude on Bedrock, see services/assistant_service.py)
  POST /api/samvad-agent/query  Claude with the Wispr Flow MCP tools (see services/samvad_agent_service.py)
  GET  /api/doctors              doctors, free or busy in a slot (see services/appointment_service.py)
  POST /api/appointments         book a consultation: Google Meet event, invite emailed to the user
  PATCH /api/appointments/{id}   change an appointment's status
  POST /api/fetch-appointments   sync Google Calendar appointments in a date range
  GET  /api/health       liveness (no auth)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="Samvad API", docs_url=None, redoc_url=None, openapi_url=None)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
    )

app.include_router(api_router)
