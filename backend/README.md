# Samvad API (FastAPI)

Thin, authenticated proxy to Sarvam AI. The Sarvam key stays on the server;
audio and text pass through and are never stored or logged.

| Endpoint | What it does |
|---|---|
| `POST /api/stt` | Short recording (≤ 30 s) → transcript (saaras:v4) |
| `WS /api/stt/stream` | Live 16 kHz PCM → partial + final transcripts |
| `POST /api/tts` | Text → WAV, female voice `ishita` (bulbul:v3, 11 languages) |
| `POST /api/translate` | Text → text (sarvam-translate:v1, 22 languages + English) |
| `GET /api/health` | Liveness, no sign-in needed |

Every endpoint except health needs the doctor's Supabase access token.

## Run locally

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt   # macOS/Linux: .venv/bin/pip
cp .env.example .env                                 # then fill SARVAM_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload
```

Run the frontend (`cd frontend && npm run dev`) in another terminal; Vite
forwards `/api` (including the WebSocket) to port 8000.

Tests: `.venv/Scripts/python -m pytest -q`

## Production

The root `Dockerfile` runs this API and Caddy in one container; Caddy serves
the app and forwards `/api/*` to uvicorn on 127.0.0.1:8000. Railway needs the
`SARVAM_API_KEY` service variable (the Supabase values are reused from the
`VITE_SUPABASE_*` variables).
