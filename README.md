<div align="center">

<img src="frontend/public/favicon.svg" width="72" height="72" alt="Samvad logo">

# Samvad

### Voice-First Medical Interpreter for Indian Clinics

**A doctor and a patient who speak different Indian languages complete a consultation together,
by voice, even when the patient has low literacy.** The doctor approves every critical detail
before anything is saved.

Samvad covers live two-way interpretation, symptom intake, prescriptions and closing instructions,
with a per-patient history of every visit.

![Status](https://img.shields.io/badge/Status-Prototype-f59e0b?style=for-the-badge)
![React](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06b6d4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-Base%20UI-111111?style=for-the-badge&logo=shadcnui&logoColor=white)
![Clerk](https://img.shields.io/badge/Auth-Clerk-6c47ff?style=for-the-badge&logo=clerk&logoColor=white)
![Languages](https://img.shields.io/badge/Languages-22%20Indian%20%2B%20English-0f9d58?style=for-the-badge)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)](LICENSE)

</div>

---

> **Early prototype (frontend only).** Patient data is fictional sample data, and speech-to-text,
> translation and text-to-speech are not connected yet. Do not use with real patients.

## Table of Contents

1. [Features](#features)
2. [Safety Principles](#safety-principles)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Getting Started](#getting-started)
6. [Credits](#credits)
7. [License](#license)

---

## Features

| Area | What it does today |
| --- | --- |
| **Doctor sign-in** | Clerk. Only doctors have accounts; patients never sign in. |
| **Patients** | Home page. Searchable, sortable table, paged to fit the screen. |
| **Interpreter** | Voice mode. Microphone-reactive orb and recorder on desktop and tablet, audio glow on phones. Audio is only measured in the browser; nothing is recorded, stored or sent. |
| **Languages** | 22 scheduled Indian languages plus English, including right-to-left scripts. Hindi, Kannada and Tamil are AI drafts awaiting native review; the rest fall back to English. |
| **Themes** | Light (default) and dark. |

Consultations, approvals, prescriptions and outside reports are placeholders for later phases.

---

## Safety Principles

These apply to every feature:

1. **Nothing is final without a human.** The doctor approves every intake field and signs every prescription; the patient confirms the read-back by voice.
2. **Confidence gates.** Low-confidence speech is never translated as fact; the patient is asked to repeat.
3. **Consent.** If the patient declines recording, nothing is kept after the session.
4. **Doctor-only prescriptions.** Never filled from patient speech.
5. **Read-backs.** Numbers, durations, drug names, allergies and yes/no answers are confirmed aloud.
6. **Verbatim.** The patient's words are stored as spoken, including code-mixed English.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4 |
| **UI** | shadcn/ui (Base UI), TanStack Table v9, Motion |
| **Auth** | Clerk |
| **Localisation** | react-i18next, Noto Sans fonts per script |
| **App** | Progressive Web App (vite-plugin-pwa) |
| **Planned** | FastAPI, Supabase, Cloudflare R2, Sarvam speech services |

---

## Project Structure

```
frontend/
└── src/
    ├── pages/            Screens: patients, interpreter, sign-in, placeholders
    ├── components/
    │   ├── ui/           shadcn/ui components
    │   ├── layout/       Sidebar, top bar, app shell
    │   ├── data-table/   Shared data table
    │   └── agents/       beui voice orb and voice note
    ├── features/         Feature logic (patients columns, mic level)
    ├── i18n/             Languages and translations
    └── data/sample.ts    Fictional sample data
```

---

## Getting Started

**Prerequisites:** Node.js 20.9+ and a [Clerk](https://clerk.com) application.

```bash
cd frontend
npm install
```

Create `frontend/.env.local` (git-ignored):

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server at http://localhost:5173 |
| `npm run build` | Type-check and production build |
| `npm run preview` | Serve the production build (needed to test the PWA) |
| `npm run lint` | Lint with oxlint |

The microphone only works on `localhost` or `https`.

---

## Credits

Third-party UI components included in the source:

- [beui](https://beui.dev): voice orb and voice note
- [uiarc](https://uiarc.dev): theme switch
- [voice-glow](https://libraries.dev/voice) (MIT): phone audio glow
- [shadcn/ui](https://ui.shadcn.com) (MIT)

---

## License

[Apache 2.0](LICENSE)
