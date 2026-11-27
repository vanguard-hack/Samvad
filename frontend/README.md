# Samvad frontend

See the [root README](../README.md) for setup and an overview. Notes specific to this folder:

- **Languages**: the list is in `src/i18n/languages.ts` and the strings in `src/i18n/locales/`. Force an interface language with `?lng=hi`.
- **Auth**: Supabase Auth (`src/lib/supabase.ts`, `src/auth/`). Doctors sign in with a 6-digit email code; the account is created on first sign-in.
- **Fonts**: Inter plus a Noto Sans font per script, bundled locally and split by unicode-range, so only scripts on screen are downloaded.
- **PWA**: the service worker caches only the app shell, never API responses or audio.
- **Design tokens** are in `src/index.css`.
- **Vendored code**: `src/components/ui`, `agents`, `motion` and `arc` come from shadcn, beui and uiarc, and are excluded from linting.
- **New dependencies**: if the dev server shows a blank page after installing a package, add it to `optimizeDeps.include` in `vite.config.ts`, or restart with `npm run dev -- --force`.
