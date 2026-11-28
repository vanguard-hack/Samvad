"""OAuth plumbing for the Wispr Flow MCP server (ported from wispr_agent/app.py).

Wispr Flow MCP uses OAuth 2.0 with dynamic client registration; there is no API key.

- If the token file already has tokens, StoredTokenAuth sends them and refreshes the
  access token with the refresh token, with no browser sign-in.
- The file can be seeded from the WISPR_OAUTH_JSON secret (seed_token_file), so a
  deployment never needs the file in the repository or the image.
- Otherwise the MCP SDK's OAuthClientProvider runs the browser sign-in. OAuthBridge
  hands its URL to the doctor and waits for /api/samvad-agent/oauth/callback.

The token file holds secrets: it is written atomically with 0600 permissions and is git-ignored.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import time
import webbrowser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

# mcp >= 2.x expects the callback handler to return AuthorizationCodeResult;
# mcp 1.x expects a (code, state) tuple. Support both.
try:
    from mcp.shared.auth import AuthorizationCodeResult  # type: ignore[attr-defined]
except ImportError:  # mcp 1.x
    AuthorizationCodeResult = None  # type: ignore[assignment,misc]

log = logging.getLogger("samvad.wispr")

REFRESH_SKEW_S = 60  # refresh this many seconds before the access token expires
RESET_HINT = "POST /api/samvad-agent/auth/reset to sign in to Wispr Flow again."


class StoredTokenError(RuntimeError):
    """The stored tokens can't be used or refreshed; a new sign-in is needed."""


def _write_private(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, path)  # atomic, so a crash can't corrupt the file
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def has_tokens(path: Path) -> bool:
    try:
        return bool(json.loads(path.read_text()).get("tokens", {}).get("access_token"))
    except (FileNotFoundError, json.JSONDecodeError, AttributeError):
        return False


def seed_token_file(path: Path, secret: str) -> bool:
    """Write the WISPR_OAUTH_JSON secret (JSON or base64 JSON) to the token file if it has no tokens.

    The file wins once it has tokens: refreshes rotate the refresh token and are saved
    there, so the secret is only a starting point. Returns True if the file was written.
    """
    if not secret or has_tokens(path):
        return False
    try:
        data = json.loads(secret)
    except json.JSONDecodeError:
        try:
            data = json.loads(base64.b64decode(secret, validate=True))
        except (binascii.Error, ValueError):
            raise StoredTokenError("WISPR_OAUTH_JSON is neither JSON nor base64-encoded JSON") from None
    if not isinstance(data, dict) or not (data.get("tokens") or {}).get("access_token"):
        raise StoredTokenError("WISPR_OAUTH_JSON has no tokens.access_token")
    _write_private(path, data)
    log.info("Seeded the Wispr Flow token file from WISPR_OAUTH_JSON")
    return True


class FileTokenStorage:
    """Persists OAuth tokens + dynamic client registration to a JSON file (browser sign-in)."""

    def __init__(self, path: Path):
        self.path = path

    def _read(self) -> dict[str, Any]:
        try:
            return json.loads(self.path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _write(self, **values: Any) -> None:
        data = self._read()
        data.update(values)
        _write_private(self.path, data)

    async def get_tokens(self) -> OAuthToken | None:
        raw = self._read().get("tokens")
        return OAuthToken.model_validate(raw) if raw else None

    async def set_tokens(self, tokens: OAuthToken) -> None:
        # tokens_saved_at lets StoredTokenAuth compute the expiry later.
        self._write(tokens=tokens.model_dump(mode="json", exclude_none=True), tokens_saved_at=time.time())

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        raw = self._read().get("client_info")
        return OAuthClientInformationFull.model_validate(raw) if raw else None

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self._write(client_info=client_info.model_dump(mode="json", exclude_none=True))


class StoredTokenAuth(httpx.Auth):
    """httpx auth that only uses tokens from an existing file, with no browser flow.

    Sends the stored access token, refreshes it shortly before expiry or after a 401,
    saves rotated tokens back to the same file, and discovers (then caches) the token
    endpoint from the server's OAuth metadata.
    """

    requires_response_body = False

    def __init__(self, server_url: str, path: Path, scope: str | None = None):
        self.server_url = server_url
        self.path = path
        self.scope = scope
        self._lock = asyncio.Lock()

    def _data(self) -> dict[str, Any]:
        return json.loads(self.path.read_text())

    def _access_token(self) -> str:
        return self._data()["tokens"]["access_token"]

    def _expires_at(self) -> float | None:
        d = self._data()
        # Files from older sign-ins have no tokens_saved_at; the file's mtime is the best guess then.
        exp, saved = d["tokens"].get("expires_in"), d.get("tokens_saved_at") or self.path.stat().st_mtime
        return float(saved) + float(exp) if exp else None

    def _needs_refresh(self) -> bool:
        exp = self._expires_at()
        return exp is not None and time.time() >= exp - REFRESH_SKEW_S

    def sync_auth_flow(self, request):
        raise RuntimeError("StoredTokenAuth only supports async clients")

    async def async_auth_flow(self, request: httpx.Request):
        if self._needs_refresh():
            async with self._lock:
                if self._needs_refresh():  # another request may have refreshed already
                    await self._refresh()

        sent = self._access_token()
        request.headers["Authorization"] = f"Bearer {sent}"
        response = yield request

        if response.status_code == 401:
            async with self._lock:
                if self._access_token() == sent:
                    await self._refresh(response.headers.get("WWW-Authenticate"))
            request.headers["Authorization"] = f"Bearer {self._access_token()}"
            yield request

    async def _refresh(self, www_authenticate: str | None = None) -> None:
        data = self._data()
        tokens = data["tokens"]
        client = data.get("client_info") or {}
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            raise StoredTokenError(f"The Wispr Flow access token expired and there is no refresh token. {RESET_HINT}")

        async with httpx.AsyncClient(timeout=30) as http:
            token_endpoint = data.get("token_endpoint") or await self._discover_token_endpoint(http, www_authenticate)

            form = {"grant_type": "refresh_token", "refresh_token": refresh_token, "resource": self.server_url}
            if self.scope:
                form["scope"] = self.scope
            headers = {"Accept": "application/json"}
            client_id, secret = client.get("client_id"), client.get("client_secret")
            method = client.get("token_endpoint_auth_method") or ("client_secret_basic" if secret else "none")
            if method == "client_secret_basic" and secret:
                headers["Authorization"] = "Basic " + base64.b64encode(f"{client_id}:{secret}".encode()).decode()
            else:
                if client_id:
                    form["client_id"] = client_id
                if method == "client_secret_post" and secret:
                    form["client_secret"] = secret

            r = await http.post(token_endpoint, data=form, headers=headers)

        if r.status_code != 200:
            # The response body is not echoed: it can contain token details.
            raise StoredTokenError(
                f"Wispr Flow rejected the token refresh ({r.status_code}); the refresh token has "
                f"probably expired or been revoked. {RESET_HINT}"
            )
        new = r.json()
        tokens["access_token"] = new["access_token"]
        tokens["token_type"] = new.get("token_type", tokens.get("token_type", "Bearer"))
        for k in ("expires_in", "scope", "id_token"):
            if k in new:
                tokens[k] = new[k]
        if new.get("refresh_token"):  # rotation: keep the new one
            tokens["refresh_token"] = new["refresh_token"]
        data.update(tokens=tokens, tokens_saved_at=time.time(), token_endpoint=token_endpoint)
        _write_private(self.path, data)
        log.info("Refreshed the Wispr Flow access token (expires in %ss)", tokens.get("expires_in", "?"))

    async def _discover_token_endpoint(self, http: httpx.AsyncClient, www_authenticate: str | None) -> str:
        u = urlparse(self.server_url)
        origin, path = f"{u.scheme}://{u.netloc}", u.path.rstrip("/")

        # 1. Protected-resource metadata (RFC 9728) -> authorization server
        prm_urls = []
        if www_authenticate:
            m = re.search(r'resource_metadata="([^"]+)"', www_authenticate)
            if m:
                prm_urls.append(m.group(1))
        prm_urls += [f"{origin}/.well-known/oauth-protected-resource{path}", f"{origin}/.well-known/oauth-protected-resource"]
        issuer = origin
        for url in prm_urls:
            try:
                r = await http.get(url)
                if r.status_code == 200 and r.json().get("authorization_servers"):
                    issuer = r.json()["authorization_servers"][0].rstrip("/")
                    break
            except (httpx.HTTPError, ValueError):
                continue

        # 2. Authorization-server metadata (RFC 8414 / OIDC) -> token_endpoint
        iu = urlparse(issuer)
        io, ip = f"{iu.scheme}://{iu.netloc}", iu.path.rstrip("/")
        as_urls = [
            f"{io}/.well-known/oauth-authorization-server{ip}",
            f"{io}/.well-known/openid-configuration{ip}",
            f"{issuer}/.well-known/openid-configuration",
        ]
        for url in dict.fromkeys(as_urls):
            try:
                r = await http.get(url)
                if r.status_code == 200 and r.json().get("token_endpoint"):
                    return r.json()["token_endpoint"]
            except (httpx.HTTPError, ValueError):
                continue
        raise StoredTokenError(f"Could not discover the token endpoint for {self.server_url}")


class OAuthBridge:
    """Hands the sign-in URL to the doctor and waits for the OAuth callback to fire."""

    def __init__(self, timeout_s: int = 600, open_browser: bool = False) -> None:
        self.timeout_s = timeout_s
        self.open_browser = open_browser
        self.pending_auth_url: str | None = None
        self._future: asyncio.Future | None = None

    async def redirect_handler(self, authorization_url: str) -> None:
        self.pending_auth_url = authorization_url
        self._future = asyncio.get_running_loop().create_future()
        log.warning("Wispr Flow sign-in required. Open this URL:\n%s", authorization_url)
        if self.open_browser:
            try:
                webbrowser.open(authorization_url)
            except Exception:  # headless server
                pass

    async def callback_handler(self):
        assert self._future is not None, "redirect_handler was not called first"
        try:
            code, state = await asyncio.wait_for(self._future, timeout=self.timeout_s)
        finally:
            self.pending_auth_url = None
        if AuthorizationCodeResult is not None:
            return AuthorizationCodeResult(code=code, state=state)
        return code, state

    def complete(self, code: str, state: str | None) -> bool:
        if self._future and not self._future.done():
            self._future.set_result((code, state))
            return True
        return False

    def fail(self, error: str) -> None:
        if self._future and not self._future.done():
            self._future.set_exception(RuntimeError(f"OAuth error: {error}"))
