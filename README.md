<div align="center">

<img src="frontend/public/favicon.svg" width="72" height="72" alt="Samvad logo">

# Samvad

### Voice-First Medical Interpreter for Indian Clinics

**A doctor and a patient who speak different Indian languages complete a consultation together,
by voice, even when the patient has low literacy.**

Samvad registers patients by voice in their own language, keeps a prioritized patient work queue,
transcribes and speaks in 22 Indian languages, and gives the doctor a voice assistant that can
use the whole app.

![Status](https://img.shields.io/badge/Status-Prototype-f59e0b?style=for-the-badge)
![React](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Python%203.12-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white)
![Sarvam](https://img.shields.io/badge/Speech-Sarvam%20AI-ff6b35?style=for-the-badge)
![Claude](https://img.shields.io/badge/Assistant-Claude%20on%20Bedrock-d97757?style=for-the-badge)
![Languages](https://img.shields.io/badge/Languages-22%20Indian%20%2B%20English-0f9d58?style=for-the-badge)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)](LICENSE)

</div>

---

> **Prototype.** Speech, the voice assistant and patient records are connected and working, but
> Samvad has not been clinically validated. Patient audio and text are processed by Sarvam AI and,
> for the assistant, by Claude on Amazon Bedrock (EU). Review data-protection requirements
> (India's DPDP Act) before using it with real patients.

## Table of Contents

1. [Features](#features)
2. [Safety Principles](#safety-principles)
3. [How It Works](#how-it-works)
4. [Tech Stack](#tech-stack)
5. [Project Structure](#project-structure)
6. [Getting Started](#getting-started)
7. [Deployment](#deployment)
8. [Credits](#credits)
9. [License](#license)

---

## Features

| Area | What it does |
| --- | --- |
| **Doctor sign-in** | Supabase Auth: email and password (with a strength meter), Google sign-in, or an 8-digit email code. Password reset and a Profile page. Only doctors have accounts. |
| **Patient work queue** | The home page. Tabs for Needs action, In progress, Waiting and Completed; search; filters for priority and clinic; sort by urgency, due time or last event. Shows reason, risk, last event and due or overdue time. |
| **Queue editing** | Per-row menu to change status or priority, or edit reason, clinic and due time. The doctor sets risk; Samvad never does it automatically. |
| **New patient by voice** | Pick the patient's language, then press **Ctrl+Space**: Samvad asks every question aloud in that language (a floating orb shows the question): name, age, sex, phone, allergies, conditions, medicines and consent. Questions are kept very short, and Claude reads each answer, correcting speech-recognition slips (e.g. "Doro 650" becomes Dolo 650) before filling the field. An answer is read back only when Claude isn't sure. The answers fill the form, and the patient's exact words are kept beside them. |
| **Patient record** | Every detail from the form, the queue fields, the patient's own words, and the full voice-intake recording (each question and answer) with playback. |
| **Voice assistant** | **Ctrl+Space** on any page opens a draggable voice orb. Ask in any Indian language to open a patient, filter the queue, look up details, update a patient, or register a new patient by voice. The reply is spoken back. |
| **Assistant conversations** | Every voice-assistant session (from Ctrl+Space until you close it) is saved and shown as a chat on the Conversations page, live while a session runs. Click the orb to open it or end the session. |
| **Interpreter** | Live transcription with detected language, and read-aloud of each line in Samvad's voice. |
| **Languages** | 22 scheduled Indian languages plus English, including right-to-left scripts. Speech-to-text covers all 23; text-to-speech covers 11 (other languages use picture mode plus a human interpreter). The doctor interface is in English, with AI-drafted Hindi, Kannada and Tamil. |
| **Themes** | Light (default) and dark. |

Consultations, approvals, prescriptions and outside reports are still placeholders.

---

## Safety Principles

1. **A human finishes the record.** The doctor reviews and presses **Add patient** or **Save**.
   *Exception, by the product owner's decision:* the voice assistant may save on its own. Every
   such save is marked "Saved by voice assistant" and announced aloud.
2. **No guessing.** Answers Samvad can't understand are asked again (up to 3 times), then left for the doctor.
3. **Consent.** A patient who declines recording is never stored: they exist only in that browser tab, and their audio is discarded.
4. **Doctor-only clinical decisions.** Samvad and its assistant never diagnose, prescribe or set risk.
5. **Read-backs when unsure.** During voice registration an answer is read back only when Claude isn't confident about it (the product owner chose speed over always confirming). Without Claude, numbers, allergies, medicines and yes/no answers are always read back.
6. **Verbatim.** The patient's words are stored as spoken, including code-mixed English, beside the translation.

Each doctor can only read and change their own patients and recordings, enforced by Supabase
row-level security and storage policies. The service worker never caches API responses or audio.

---

## How It Works

```
Browser (React PWA)
  │  Supabase Auth session ──► Supabase: patients table + private patient-audio bucket (RLS)
  │
  └─ /api/* ──► FastAPI backend (same origin, behind Caddy)
                 ├─ Sarvam AI: speech-to-text (saaras:v4, live + short clips),
                 │             text-to-speech (bulbul:v3, voice "ishita"), translation
                 ├─ Voice intake: questions in the patient's language, answer parsing
                 └─ Voice assistant: Claude Sonnet 4.6 on Amazon Bedrock with tools
                      - data tools run against Supabase with the doctor's own token
                      - page tools (open a page, filter the queue, start a registration)
                        are returned to the browser to carry out
```

The backend holds every API key. The browser only ever sends the doctor's Supabase session token,
which the backend checks on each request.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, PWA (vite-plugin-pwa) |
| **UI** | shadcn/ui (Base UI), TanStack Table v9, Motion |
| **Backend** | FastAPI (Python 3.12), uvicorn, httpx |
| **Auth and data** | Supabase Auth, Postgres with row-level security, Storage |
| **Speech** | Sarvam AI (`sarvamai` SDK): saaras:v4, bulbul:v3, sarvam-translate:v1 |
| **Assistant** | Claude Sonnet 4.6 on Amazon Bedrock (`anthropic[bedrock]` 1.17) |
| **Localisation** | react-i18next, Noto Sans fonts per script |
| **Deployment** | Docker (Caddy + uvicorn in one image) on Railway, GitHub Actions CI |

---

## Project Structure

```
frontend/src/
├── pages/              Patients queue, patient record, interpreter, sign-in, profile, reset password
├── features/
│   ├── patients/       Queue columns, New patient dialog, voice intake, Supabase data layer
│   ├── assistant/      Ctrl+Space voice assistant and its action bus
│   ├── speech/         Live transcription, 16 kHz capture, playback, WAV
│   └── interpreter/    Voice orb and microphone level
├── components/         shadcn/ui, layout (sidebar, top bar), vendored beui / uiarc components
├── auth/               Supabase session, password rules, route guards
└── i18n/               Languages and translations

backend/app/
├── main.py             API: health, speech-to-text (REST + WebSocket), text-to-speech, translate
├── intake.py           Voice-intake questions and answer parsing
├── assistant.py        Claude voice assistant and its tools
├── auth.py             Supabase token check
├── languages.py        Samvad ↔ Sarvam language codes
└── config.py           Settings from environment / backend/.env

supabase/migrations/    Database schema (patients, assistant conversations), storage bucket and policies
deploy/                 Caddyfile and container start script
Dockerfile              One image: built frontend + API
```

---

## Getting Started

**Prerequisites:** Node.js 20.19+, Python 3.11+, a [Supabase](https://supabase.com) project, a
[Sarvam AI](https://dashboard.sarvam.ai) API key, and, for the voice assistant, AWS credentials
with access to Claude on Amazon Bedrock.

### 1. Database

Apply the files in `supabase/migrations/` in order (Supabase SQL Editor, or `supabase db push`).
They create the `patients` table with row-level security and the private `patient-audio` bucket.

In Supabase Auth, enable email sign-in and Google if you want it, and add `{{ .Token }}` to the
Magic Link, Confirm signup and Reset password email templates.

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt      # macOS/Linux: .venv/bin/pip
cp .env.example .env                                    # then fill it in (see below)
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload
```

`backend/.env` (git-ignored; never commit real keys):

| Variable | What it is |
| --- | --- |
| `SARVAM_API_KEY` | Sarvam AI key (set the Sarvam workspace data retention to 0 days) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | The same public values the frontend uses |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | AWS key allowed to call Bedrock |
| `AWS_REGION` | Bedrock region, e.g. `eu-west-3` |
| `BEDROCK_MODEL_ID` | e.g. `eu.anthropic.claude-sonnet-4-6` |

Check it at http://localhost:8000/api/health (`"speech": true` means Sarvam is configured).
Run the tests with `.venv/Scripts/python -m pytest -q`.

### 3. Frontend

```bash
cd frontend
npm install
```

`frontend/.env.local` (git-ignored; public values only, never API keys):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server at http://localhost:5173 (forwards `/api` to the backend on port 8000) |
| `npm run build` | Type-check and production build |
| `npm run preview` | Serve the production build (needed to test the PWA) |
| `npm run lint` | Lint with oxlint |

The microphone only works on `localhost` or `https`. Use headphones or a quiet room for voice
features, so Samvad doesn't hear its own voice.

---

## Deployment

Railway builds the root `Dockerfile` on every push to `main`. The image serves the built frontend
with Caddy and runs the API on an internal port; Caddy forwards `/api/*` to it.

Railway service variables:

- **Build time:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Run time:** `SARVAM_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_MODEL_ID`

GitHub Actions runs the frontend lint and build, the backend tests, then builds the Docker image
and checks that the site and `/api/health` respond.

---

## Credits

Third-party UI components included in the source:

- [beui](https://beui.dev): voice orb and voice note
- [uiarc](https://uiarc.dev): user menu and theme switch
- [ReUI](https://reui.io): password strength input
- [voice-glow](https://libraries.dev/voice) (MIT): phone audio glow
- [shadcn/ui](https://ui.shadcn.com) (MIT)

Speech by [Sarvam AI](https://www.sarvam.ai). Assistant by [Claude](https://www.anthropic.com/claude) on Amazon Bedrock.

---

## License

[Apache 2.0](LICENSE)
