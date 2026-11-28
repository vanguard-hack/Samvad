"""Samvad agent: Claude (on Amazon Bedrock) answering questions with the Wispr Flow MCP tools.

Ported from wispr_agent/app.py. The LangChain + LiteLLM agent there is replaced by
the same tool-use loop the voice assistant uses, on the shared Bedrock client, so
the API needs only the `mcp` package on top of what it already has.

- On first use the agent connects to the Wispr Flow MCP server and lists its tools
  once (cached). With a stored token file that takes a few seconds; without one, a
  Wispr Flow sign-in URL is returned to the doctor (see core/wispr_auth.py).
- That MCP session stays open and is shared by every request (core/mcp_connection.py).
  If it breaks, the next call reopens it and retries once. Tool calls Claude makes in
  the same turn run in parallel, each with a timeout.
- Wispr Flow access is read-only. One Wispr Flow account is connected for the whole
  server, so every signed-in doctor queries the same account.
- Conversation history is kept in memory only (never written to disk), per doctor
  and session id, capped in size and dropped after an hour without use.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import OrderedDict
from datetime import timedelta
from typing import Any

import httpx
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from fastapi import HTTPException, status
from mcp.client.auth import OAuthClientProvider
from mcp.shared.auth import OAuthClientMetadata
from mcp.shared.exceptions import McpError

from app.core.bedrock import bedrock
from app.core.config import get_settings
from app.core.mcp_connection import McpConnection, root_cause
from app.core.wispr_auth import FileTokenStorage, OAuthBridge, StoredTokenAuth, StoredTokenError, has_tokens, seed_token_file
from app.schemas.samvad_agent import AgentQueryIn, AgentQueryOut

log = logging.getLogger("samvad.agent")

MAX_STEPS = 10  # model calls per query
MAX_TOOL_RESULT_CHARS = 60_000  # long transcripts come back in portions; keep each one bounded
TOOL_TIMEOUT_S = 60  # one Wispr Flow tool call
READY_WAIT_S = 20  # how long a request waits for the first MCP connection
MAX_TURNS = 20  # remembered user + assistant turns per conversation
MAX_SESSIONS = 200
SESSION_TTL_S = 3600

SYSTEM_PROMPT = """You are the Samvad agent, an assistant connected to the doctor's Wispr Flow
account through its MCP server. Wispr Flow access is READ-ONLY: Notetaker meetings,
summaries, transcripts, attendees, calendar events and Scratchpad notes.

- When asked what you can do, or to list tools/functionalities, describe EVERY tool
  you have: its name, what it does, and its key parameters. Group them by purpose
  (meetings, transcripts, calendar, notes, account) and give one example question each.
- For data questions, call the tools; never invent meetings, notes or attendees.
- When several lookups don't depend on each other, request them together in one turn.
- Long transcripts come back in portions; fetch further portions if needed.
- If a tool says "Too many requests", tell the user to retry in about a minute.
- Never diagnose, prescribe, or suggest medicines or doses; clinical decisions are the doctor's.
"""


def _tool_result_text(result: Any) -> str:
    parts = []
    for block in result.content or []:
        text = getattr(block, "text", None)
        parts.append(text if text is not None else json.dumps(block.model_dump(mode="json", exclude_none=True)))
    if not parts and getattr(result, "structuredContent", None):
        parts.append(json.dumps(result.structuredContent))
    text = "\n".join(parts) or "(empty result)"
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + "\n[truncated]"
    return text


class WisprAgent:
    def __init__(self) -> None:
        s = get_settings()
        self.bridge = OAuthBridge(timeout_s=s.wispr_auth_timeout_s, open_browser=s.wispr_open_browser)
        self.auth_mode: str | None = None  # "stored-token" or "browser-oauth"
        self.conn: McpConnection | None = None
        self.tools: list[dict[str, Any]] = []  # cached, in Anthropic tool format
        self.ready = False
        self.error: str | None = None
        self._init_task: asyncio.Task | None = None
        self._skip_seed = False  # set by reset(): the doctor wants a fresh sign-in, not the old secret
        self._sessions: OrderedDict[tuple[str, str], tuple[float, list[dict]]] = OrderedDict()

    # ---- connection ----
    def _build_auth(self) -> httpx.Auth:
        """Use the stored tokens if there are any; otherwise do the browser sign-in."""
        s = get_settings()
        if not self._skip_seed:
            seed_token_file(s.wispr_token_file, s.wispr_oauth_json)
        if has_tokens(s.wispr_token_file):
            self.auth_mode = "stored-token"
            log.info("Using stored Wispr Flow tokens (no browser sign-in)")
            return StoredTokenAuth(s.wispr_mcp_url, s.wispr_token_file, s.wispr_oauth_scope)

        self.auth_mode = "browser-oauth"
        log.info("No Wispr Flow tokens; starting browser sign-in")
        return OAuthClientProvider(
            server_url=s.wispr_mcp_url,
            client_metadata=OAuthClientMetadata(
                client_name="Samvad Agent",
                redirect_uris=[s.wispr_redirect_uri],
                grant_types=["authorization_code", "refresh_token"],
                response_types=["code"],
                scope=s.wispr_oauth_scope,
            ),
            storage=FileTokenStorage(s.wispr_token_file),
            redirect_handler=self.bridge.redirect_handler,
            callback_handler=self.bridge.callback_handler,
        )

    async def initialize(self) -> None:
        """Connect to Wispr Flow MCP and cache its tools; the session stays open for tool calls."""
        try:
            if self.conn:
                await self.conn.close()
            self.conn = McpConnection(get_settings().wispr_mcp_url, self._build_auth())
            listed = await (await self.conn.session()).list_tools()
            self.tools = [
                {"name": t.name, "description": t.description or "", "input_schema": t.inputSchema or {"type": "object"}}
                for t in listed.tools
            ]
            log.info("Loaded %d Wispr Flow MCP tools: %s", len(self.tools), ", ".join(t["name"] for t in self.tools))
            self.error = None
            self.ready = True
        except BaseException as e:  # anyio wraps errors in ExceptionGroup
            if isinstance(e, (KeyboardInterrupt, SystemExit, asyncio.CancelledError)):
                raise
            root = root_cause(e)
            self.error = f"{type(root).__name__}: {root}"
            log.error("Could not connect to Wispr Flow MCP: %s", self.error)

    def start(self) -> None:
        """Start connecting unless connected or already connecting (a sign-in may be pending)."""
        if self.ready or (self._init_task and not self._init_task.done()):
            return
        self._init_task = asyncio.create_task(self.initialize())

    async def reset(self) -> bool:
        """Forget the connection and the stored tokens, then start a fresh sign-in."""
        if self._init_task and not self._init_task.done():
            self._init_task.cancel()
        if self.conn:
            await self.conn.close()
        path = get_settings().wispr_token_file
        removed = path.exists()
        if removed:
            path.unlink()
        self.ready, self.tools, self.conn, self.error = False, [], None, None
        self.bridge.pending_auth_url = None
        self._skip_seed = True
        self.start()
        return removed

    async def wait_ready(self, timeout: float = READY_WAIT_S) -> None:
        """Connect if needed; raise 503 (with a sign-in URL when one is pending) if not ready in time."""
        self.start()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while not self.ready and not self.bridge.pending_auth_url and loop.time() < deadline:
            if self._init_task is None or self._init_task.done():
                break
            await asyncio.sleep(0.1)
        if self.ready:
            return
        if self.bridge.pending_auth_url:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                {"message": "Sign in to Wispr Flow first", "auth_url": self.bridge.pending_auth_url},
            )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"message": "Samvad agent is not ready", "error": self.error or "connecting to Wispr Flow"},
        )

    def status(self) -> dict:
        return {
            "connected": self.ready,
            "auth_mode": self.auth_mode,
            "auth_url": self.bridge.pending_auth_url,
            "error": self.error,
            "redirect_uri": get_settings().wispr_redirect_uri,
        }

    # ---- tools ----
    async def call_tool(self, name: str, args: dict) -> tuple[str, bool]:
        """(result text, is_error) for one MCP tool call. Errors go back to Claude as the result."""
        conn = self.conn
        if conn is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {"message": "Samvad agent is not ready"})
        for attempt in (1, 2):
            try:
                session = await conn.session()
                result = await session.call_tool(name, args, read_timeout_seconds=timedelta(seconds=TOOL_TIMEOUT_S))
                return _tool_result_text(result), bool(result.isError)
            except BaseException as e:
                if isinstance(e, (KeyboardInterrupt, SystemExit, asyncio.CancelledError)):
                    raise
                root = root_cause(e)
                if isinstance(root, StoredTokenError):
                    self.ready, self.error = False, str(root)
                    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {"message": str(root)}) from None
                log.warning("Wispr Flow tool %s failed (attempt %d): %s", name, attempt, type(root).__name__)
                if isinstance(root, McpError) and root.error.code == httpx.codes.REQUEST_TIMEOUT:
                    return f"The {name} tool timed out after {TOOL_TIMEOUT_S} s. Try a narrower request.", True
                if attempt == 2 or isinstance(root, McpError):
                    # McpError is the server's own answer (e.g. bad arguments): retrying won't help.
                    return f"Tool call failed: {type(root).__name__}: {root}", True
                await conn.close()  # broken session (dropped or expired): reopen and retry once
        raise AssertionError("unreachable")

    # ---- conversation memory ----
    def _history(self, key: tuple[str, str]) -> list[dict]:
        now = time.monotonic()
        for k in [k for k, (used, _) in self._sessions.items() if now - used > SESSION_TTL_S]:
            del self._sessions[k]
        _, turns = self._sessions.pop(key, (now, []))
        self._sessions[key] = (now, turns)
        while len(self._sessions) > MAX_SESSIONS:
            self._sessions.popitem(last=False)
        return turns

    # ---- agent ----
    async def query(self, user_id: str, body: AgentQueryIn) -> AgentQueryOut:
        s = get_settings()
        client = bedrock()  # 503 when Bedrock isn't configured
        await self.wait_ready()

        history = self._history((user_id, body.session_id))
        messages: list[dict] = [*history, {"role": "user", "content": body.query}]
        reply = ""
        try:
            for _ in range(MAX_STEPS):
                response = await client.messages.create(
                    model=s.bedrock_model,
                    max_tokens=4000,
                    # Tools + system are identical on every call, so this prefix is cached.
                    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                    tools=self.tools,
                    thinking={"type": "adaptive"},
                    messages=messages,
                )
                if response.stop_reason == "refusal":
                    reply = "Sorry, I can't help with that."
                    break
                texts = [b.text.strip() for b in response.content if b.type == "text" and b.text.strip()]
                calls = [b for b in response.content if b.type == "tool_use"]
                if texts:
                    reply = "\n\n".join(texts)
                if response.stop_reason != "tool_use" or not calls:
                    break

                messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in response.content]})
                # Read-only lookups that Claude asked for together: run them in parallel.
                outcomes = await asyncio.gather(*(self.call_tool(c.name, c.input) for c in calls))
                messages.append({
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": c.id, "content": text, "is_error": is_error}
                        for c, (text, is_error) in zip(calls, outcomes)
                    ],
                })
            else:
                reply = reply or "That took too many steps. Try a narrower question."
        except RateLimitError:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Agent is busy, try again in a moment") from None
        except APIStatusError as exc:
            log.warning("Bedrock error %s", exc.status_code)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Agent error") from None
        except APIConnectionError:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach the agent model") from None

        reply = reply or "Done."
        history += [{"role": "user", "content": body.query}, {"role": "assistant", "content": reply}]
        del history[:-MAX_TURNS]
        return AgentQueryOut(session_id=body.session_id, response=reply, tools_available=[t["name"] for t in self.tools])


wispr_agent = WisprAgent()
