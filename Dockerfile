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
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

COPY frontend/ ./
# Fail loudly (without printing values) instead of shipping a build that
# can't sign anyone in. On Railway, add the variables and apply/deploy them.
RUN test -n "$VITE_SUPABASE_URL" || { echo "ERROR: VITE_SUPABASE_URL is not set for this build" >&2; exit 1; }
RUN test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" || { echo "ERROR: VITE_SUPABASE_PUBLISHABLE_KEY is not set for this build" >&2; exit 1; }
RUN npm run build

# ── Serve: Caddy (website, public $PORT) + FastAPI (/api, internal :8000) ──────
FROM python:3.12-slim
# Caddy is a single static binary; take it from the official image.
COPY --from=caddy:2-alpine /usr/bin/caddy /usr/bin/caddy

WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/start.sh /start.sh
# Strip Windows line endings in case the script was checked out with CRLF.
RUN sed -i 's/\r$//' /start.sh && chmod +x /start.sh
COPY --from=build /app/frontend/dist /srv

# Runtime variables (Railway service variables), read when the API starts: SARVAM_API_KEY,
# AWS_* + BEDROCK_MODEL_ID, GOOGLE_OAUTH_* (+ optional GOOGLE_CALENDAR_*), WISPR_OAUTH_JSON,
# plus the VITE_SUPABASE_* values above, which the API reuses to check sign-ins.
ENV PYTHONUNBUFFERED=1
# Railway injects PORT at runtime; the Caddyfile falls back to 8080.
EXPOSE 8080
CMD ["/start.sh"]
