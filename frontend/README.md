# Samvad frontend

See the [root README](../README.md) for setup and an overview. Notes specific to this folder:

- **Languages**: the list is in `src/i18n/languages.ts` and the strings in `src/i18n/locales/`. Force an interface language with `?lng=hi`.
- **Auth**: Supabase Auth (`src/lib/supabase.ts`, `src/auth/`). Email and password, Google, or an 8-digit email code.
- **Backend calls**: `src/lib/api.ts` sends the Supabase token to `/api/*`. In development Vite forwards `/api` (including WebSockets) to the FastAPI backend on port 8000.
- **Voice assistant**: `src/features/assistant/`. Page actions from the assistant reach the patients page through `assistant-bus.ts`.
- **Fonts**: Inter plus a Noto Sans font per script, bundled locally and split by unicode-range, so only scripts on screen are downloaded.
- **PWA**: the service worker caches only the app shell, never API responses or audio.
- **Design tokens** are in `src/index.css`.
- **Vendored code**: `src/components/ui`, `agents`, `motion` and `arc` come from shadcn, beui and uiarc, and are excluded from linting.
- **New dependencies**: if the dev server shows a blank page after installing a package, add it to `optimizeDeps.include` in `vite.config.ts`, or restart with `npm run dev -- --force`.
