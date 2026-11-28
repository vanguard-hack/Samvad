#!/usr/bin/env python3
"""
Sign the Samvad backend in to Google Calendar as your Google account (one time).

Gets an OAuth refresh token for the calendar.events scope and saves it in
backend/.env.local as GOOGLE_OAUTH_REFRESH_TOKEN (that file is git-ignored).
With it the backend creates appointments in your own calendar, with Google
Meet links and email invites to guests. On Railway, set the same three
GOOGLE_OAUTH_* variables as secrets.

Before running: in Google Cloud Console (same project as the Calendar API),
create an OAuth client of type "Desktop app" and put its id and secret in
backend/.env.local as GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET
(or pass --client-id / --client-secret).

Usage (from backend/)
    python scripts/google_oauth_login.py            # opens Google sign-in, saves the token to .env.local
    python scripts/google_oauth_login.py --print    # print the token instead (it is a secret!)

Uses only the standard library. Nothing secret is printed unless --print.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ENV_FILE = BACKEND / ".env.local"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/calendar.events"
TIMEOUT_S = 300


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for path in (BACKEND / ".env", ENV_FILE):  # .env.local wins
        if path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    values[key.strip()] = value.strip().strip('"').strip("'")
    return {**values, **{k: v for k, v in os.environ.items() if k.startswith("GOOGLE_OAUTH_")}}


def save_env(updates: dict[str, str]) -> None:
    """Set keys in .env.local, keeping every other line as it is."""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.is_file() else []
    done: set[str] = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in updates and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={updates[key]}"
            done.add(key)
    lines += [f"{k}={v}" for k, v in updates.items() if k not in done]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    result: dict[str, str] = {}
    done = threading.Event()

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
        if "code" not in params and "error" not in params:
            self.send_response(404)
            self.end_headers()
            return
        CallbackHandler.result = params
        ok = "code" in params
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        message = "Samvad is signed in to Google Calendar. You can close this tab." if ok else "Google sign-in failed."
        self.wfile.write(f"<h3>{message}</h3>".encode())
        CallbackHandler.done.set()

    def log_message(self, *args: object) -> None:  # keep the console quiet
        pass


def exchange(code: str, verifier: str, redirect_uri: str, client_id: str, client_secret: str) -> dict:
    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        }
    ).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body, method="POST"), timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as exc:
        detail = json.loads(exc.read() or b"{}")
        sys.exit(f"Google refused the sign-in: {detail.get('error')}: {detail.get('error_description', '')}")


def check_calendar(access_token: str, calendar_id: str) -> None:
    url = f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar_id, safe='')}/events?maxResults=1"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30):
            print(f"Checked: this account can read the calendar '{calendar_id}'.")
    except urllib.error.HTTPError as exc:
        print(f"Warning: the calendar '{calendar_id}' answered {exc.code}. Check GOOGLE_CALENDAR_ID for this account.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--client-id")
    parser.add_argument("--client-secret")
    parser.add_argument("--print", action="store_true", help="print the refresh token instead of saving it")
    args = parser.parse_args()

    env = read_env()
    client_id = args.client_id or env.get("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = args.client_secret or env.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        sys.exit("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in backend/.env.local (a 'Desktop app' OAuth client).")

    server = http.server.HTTPServer(("127.0.0.1", 0), CallbackHandler)
    redirect_uri = f"http://127.0.0.1:{server.server_port}/"
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    url = AUTH_URL + "?" + urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",  # a refresh token, so the backend works unattended
            "prompt": "consent",  # always return the refresh token, even on a repeat sign-in
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )

    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("Opening Google sign-in in your browser. If it doesn't open, visit:\n" + url)
    webbrowser.open(url)
    if not CallbackHandler.done.wait(TIMEOUT_S):
        server.shutdown()
        sys.exit("Timed out waiting for Google sign-in.")
    server.shutdown()

    result = CallbackHandler.result
    if result.get("state") != state:
        sys.exit("Sign-in response did not match this request (state mismatch). Run the script again.")
    if "error" in result:
        sys.exit(f"Google sign-in failed: {result['error']}")

    tokens = exchange(result["code"], verifier, redirect_uri, client_id, client_secret)
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        sys.exit("Google returned no refresh token. Remove Samvad's access at myaccount.google.com/permissions and run again.")
    if SCOPE not in tokens.get("scope", ""):
        sys.exit("Calendar access was not granted. Run again and tick the Google Calendar permission.")

    check_calendar(tokens["access_token"], env.get("GOOGLE_CALENDAR_ID") or "primary")
    if args.print:
        print(f"GOOGLE_OAUTH_REFRESH_TOKEN={refresh_token}")
        return
    save_env({"GOOGLE_OAUTH_CLIENT_ID": client_id, "GOOGLE_OAUTH_CLIENT_SECRET": client_secret, "GOOGLE_OAUTH_REFRESH_TOKEN": refresh_token})
    print(f"Saved GOOGLE_OAUTH_* to {ENV_FILE} (git-ignored). Restart the backend to use it.")


if __name__ == "__main__":
    main()
