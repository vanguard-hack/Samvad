# Samvad — frontend

React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui (Base UI, `base-nova`) PWA. Doctor auth via Clerk.

UI components are limited to shadcn Badge, Pagination, Sidebar, Skeleton, Tooltip, the Vite
dark-mode toggle and the Data table (TanStack Table v9), plus the primitives those use.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run lint
```

`frontend/.env.local` (git-ignored):

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Without the key the app shows a configuration screen instead of crashing.

## Notes

- **Interface language**: 22 scheduled Indian languages + English. Hindi, Kannada and Tamil
  strings are AI drafts marked *Draft* in the picker until a native speaker reviews them;
  the rest fall back to English. Force a language with `?lng=hi`.
- **Clerk widget language**: Clerk ships only en, hi, bn, ta, te. Its locale bundle is
  lazy-loaded only when one of those Indian locales is chosen.
- **Fonts**: Inter + Noto Sans per script, bundled (no Google Fonts CDN), split by
  unicode-range so only on-screen scripts download.
- **PWA**: precaches the app shell only. API responses and audio are never cached by the
  service worker (Critical Rule 3).
- **Design**: tokens in `src/index.css`, derived from `DESIGN-apple.md`, with clinical
  deviations documented at the top of that file.
