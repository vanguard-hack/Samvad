# Samvad frontend: build the Vite PWA, then serve it as static files with Caddy.
# Railway builds this from the repo root (see railway.json).

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app/frontend

# Install dependencies first so this layer is cached between code changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Vite inlines VITE_* variables at build time. Railway passes service
# variables to the build when they are declared as ARGs.
# The Clerk publishable key is public by design (it ships in the browser bundle).
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

COPY frontend/ ./
RUN npm run build

# ── Serve ────────────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv

# Railway injects PORT at runtime; the Caddyfile falls back to 8080.
EXPOSE 8080
