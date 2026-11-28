#!/usr/bin/env bash
# Runs the FastAPI backend (internal only, 127.0.0.1:8000) and Caddy (public,
# $PORT). If either process exits, the container exits so Railway restarts it.
set -euo pipefail

cd /app/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log &

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &

wait -n
exit $?
