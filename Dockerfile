# Samvad frontend: build the Vite PWA, then serve it as static files with Caddy.
# Railway detects this Dockerfile at the repo root and builds it automatically.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app/frontend

# Install dependencies first so this layer is cached between code changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Vite inlines VITE_* variables at build time. Railway passes service
# variables to the build when they are declared as ARGs.
# Both are public by design (they ship in the browser bundle); never pass the
# Supabase secret / service_role key here.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL     VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

COPY frontend/ ./
RUN npm run build

# ── Serve ────────────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv

# Railway injects PORT at runtime; the Caddyfile falls back to 8080.
EXPOSE 8080
