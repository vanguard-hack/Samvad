# Samvad API (FastAPI)

Thin, authenticated proxy to Sarvam AI. The Sarvam key stays on the server;
audio and text pass through and are never stored or logged.

| Endpoint | What it does |
|---|---|
| `POST /api/stt` | Short recording (≤ 30 s) → transcript (saaras:v4) |
| `WS /api/stt/stream` | Live 16 kHz PCM → partial + final transcripts |
| `POST /api/tts` | Text → WAV, female voice `ishita` (bulbul:v3, 11 languages) |
| `POST /api/translate` | Text → text (sarvam-translate:v1, 22 languages + English) |
| `POST /api/samvad-agent/query` | Claude with the Wispr Flow MCP tools (`/tools`, `/auth/*` alongside) |
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

## Code layout

Follows the `fastapi-templates` skill (`.agents/skills/fastapi-templates`):

```
app/
├── main.py                 # FastAPI app, CORS, mounts api_router
├── api/
│   ├── router.py           # every endpoint router under /api
│   ├── dependencies.py     # current_user / current_session (Supabase bearer token)
│   └── endpoints/          # health, stt (+ WS stream), tts, translate, intake, assistant
├── core/
│   ├── config.py           # Settings from env / backend/.env
│   ├── security.py         # Supabase Auth token check (cached 60 s)
│   ├── sarvam.py           # Sarvam client + safe upstream error mapping
│   ├── bedrock.py          # Claude on Amazon Bedrock client
│   ├── mcp_connection.py   # one shared MCP client session (Wispr Flow)
│   ├── wispr_auth.py       # Wispr Flow OAuth: stored tokens, refresh, browser sign-in
│   ├── exceptions.py       # ToolError (assistant tool failures)
│   └── languages.py        # Samvad → Sarvam language codes
├── schemas/                # Pydantic request bodies
├── services/               # speech, live stream relay, voice intake (+ pure parser), assistant (+ tools), samvad_agent (Wispr Flow MCP)
├── models/                 # reserved: the API owns no tables yet
└── repositories/           # patient_repository: Supabase REST as the doctor (RLS)
tests/
```

## Samvad agent (Wispr Flow MCP)

`POST /api/samvad-agent/query` with `{"query": "...", "session_id": "..."}` runs Claude
(`BEDROCK_MODEL_ID`) with the 16 read-only Wispr Flow MCP tools and returns
`{"session_id", "response", "tools_available"}`. One Wispr Flow account is connected for the
whole server. One MCP session is kept open and shared; tool calls Claude makes in the same
turn run in parallel, each with a 60 s timeout.

- If `WISPR_TOKEN_FILE` (default `backend/.wispr_oauth.json`, git-ignored) has tokens, they are
  used and refreshed automatically. A token file from `wispr_agent` works.
- Otherwise the first request returns 503 with an `auth_url`. Open it, sign in to Wispr Flow,
  and the browser is sent back to `PUBLIC_BASE_URL/api/samvad-agent/oauth/callback`.
- `GET /api/samvad-agent/auth/status`, `POST .../auth/retry`, `POST .../auth/reset` (deletes
  the tokens and starts a new sign-in), `GET .../tools`.

### Wispr Flow on Railway

The token file is git-ignored and the Dockerfile copies only `backend/app`, so it never
reaches GitHub or the image. Supply it at runtime instead:

1. Add a Railway volume mounted at `/data` and set `WISPR_TOKEN_FILE=/data/wispr_oauth.json`.
   Refreshes rotate the refresh token, so the file must survive redeploys.
2. Either seed it: run `python make_railway_secret.py` in `wispr_agent` and paste the value into
   the secret variable `WISPR_OAUTH_JSON`. It is written to the volume only while the file has
   no tokens; after that the file wins. Then stop using that token file locally.
3. Or sign in on Railway: set `PUBLIC_BASE_URL=https://<your-app>.up.railway.app`, sign in to
   Samvad there, and in that tab's browser console run
   `fetch('/api/samvad-agent/auth/status',{headers:{Authorization:'Bearer '+JSON.parse(localStorage[Object.keys(localStorage).find(k=>k.endsWith('-auth-token'))]).access_token}}).then(r=>r.json()).then(console.log)`.
   Open the `auth_url` it prints within `WISPR_AUTH_TIMEOUT_S`; the tokens are saved to the volume.

## Google Calendar (appointments)

Consultations are booked from the Consultations page: pick a slot, a patient and a free
doctor (`GET /api/doctors`, `POST /api/appointments`). Each booking is a Google Calendar
event with a Google Meet link; the invite, with the patient and doctor details, is emailed
to the signed-in user. Appointments are mirrored in the Supabase `appointments` table;
doctors come from the `doctors` table (both in `supabase/migrations`).

The backend signs in to Google as the clinic's Google account (OAuth), from env variables only:

1. Google Cloud Console, in the project with the Calendar API enabled: *APIs & Services →
   OAuth consent screen*, user type External, add the account as a test user and the
   `.../auth/calendar.events` scope.
2. *Credentials → Create credentials → OAuth client ID → Desktop app*. Put its id and secret
   in `backend/.env.local` as `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
3. `python scripts/google_oauth_login.py` opens Google sign-in and saves
   `GOOGLE_OAUTH_REFRESH_TOKEN` to `.env.local`. Restart the backend.
4. **Railway:** add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REFRESH_TOKEN`, and optionally `GOOGLE_CALENDAR_ID` and
   `GOOGLE_CALENDAR_TIMEZONE`, as service variables (copy the values from `.env.local`).
   They are read at runtime, so no rebuild is needed; redeploy to apply.

While the consent screen is in *Testing*, Google expires the refresh token after 7 days: run the
script again, or set the app to *In production* (an unverified app you use yourself is fine).

## Production

The root `Dockerfile` runs this API and Caddy in one container; Caddy serves
the app and forwards `/api/*` to uvicorn on 127.0.0.1:8000. Railway needs the
`SARVAM_API_KEY` service variable (the Supabase values are reused from the
`VITE_SUPABASE_*` variables).
