# Samvad

A voice-first, two-way medical interpreter for Indian clinics. A doctor and a patient who speak different languages complete a consultation together, and the doctor approves every critical detail before anything is saved.

> **Status: early prototype (frontend only).** Patient data is fictional sample data, and speech-to-text, translation and text-to-speech are not connected yet. Do not use with real patients.

## What works today

- **Doctor sign-in** with Clerk. Only doctors have accounts; patients never sign in.
- **Patients** (home page): searchable, sortable table, paged to fit the screen.
- **Interpreter**: voice mode with a microphone-reactive orb and recorder on desktop and tablet, and an audio glow on phones. Audio is only measured in the browser. Nothing is recorded, stored or sent.
- **Interface languages**: 22 scheduled Indian languages plus English, including right-to-left scripts. Hindi, Kannada and Tamil are AI drafts awaiting native review; the rest fall back to English.
- **Light and dark** themes.

Consultations, approvals, prescriptions and outside reports are placeholders for later phases.

## Getting started

Requires **Node.js 20.9+**.

```bash
cd frontend
npm install
```

Create `frontend/.env.local` (git-ignored) with your Clerk publishable key:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Then run:

```bash
npm run dev       # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check and production build |
| `npm run preview` | Serve the production build (needed to test the PWA) |
| `npm run lint` | Lint with oxlint |

The microphone only works on `localhost` or `https`.

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Base UI), TanStack Table v9, Clerk, react-i18next, PWA via vite-plugin-pwa.

Planned for later phases: FastAPI backend, Supabase, Cloudflare R2, Sarvam speech services.

## Project structure

```
frontend/
  src/
    pages/           Screens (patients, interpreter, sign-in, placeholders)
    components/
      ui/            shadcn/ui components
      layout/        Sidebar, top bar, app shell
      data-table/    Shared data table
      agents/        beui voice orb and voice note
    features/        Feature logic (patients columns, mic level)
    i18n/            Languages and translations
    data/sample.ts   Fictional sample data
```

## Safety principles

These apply to every feature:

1. Nothing is final without a human: the doctor approves every intake field and signs every prescription, and the patient confirms the read-back by voice.
2. Low-confidence speech is never translated as fact; the patient is asked to repeat.
3. If the patient declines recording consent, nothing is kept after the session.
4. Prescriptions come only from the doctor, never from patient speech.
5. Numbers, durations, drug names, allergies and yes/no answers are read back and confirmed.
6. The patient's words are stored verbatim, including code-mixed English.

## Credits

Third-party UI components included in the source:

- [beui](https://beui.dev): voice orb and voice note
- [uiarc](https://uiarc.dev): theme switch
- [voice-glow](https://libraries.dev/voice) (MIT): phone audio glow
- [shadcn/ui](https://ui.shadcn.com) (MIT)

## License

[Apache 2.0](LICENSE)
