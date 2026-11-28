"""Samvad agent: Claude (on Amazon Bedrock) for the Samvad Assistant page.

Claude answers from the doctor's schedule and patients (services/samvad_tools.py, run
as the signed-in doctor) and from the read-only Wispr Flow MCP tools (meetings and
notes). It finishes by calling a `present_answer` tool, so the page gets a
structured reply: paragraphs, appointment cards and follow-up suggestions. The
prompt is in services/samvad_agent_prompt.py.

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
import datetime as dt
import json
import logging
import re
import time
from collections import OrderedDict
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
from app.schemas.appointments import Appointment
from app.schemas.samvad_agent import AgentQueryIn, AgentQueryOut
from app.services import samvad_tools
from app.services.samvad_agent_prompt import SYSTEM_PROMPT, context_block
from app.services.samvad_tools import ANSWER_TOOL, SamvadTools, humanize_tool_names, today_line

log = logging.getLogger("samvad.agent")

MAX_STEPS = 10  # model calls per query
MAX_TOOL_RESULT_CHARS = 60_000  # long transcripts come back in portions; keep each one bounded
TOOL_TIMEOUT_S = 60  # one Wispr Flow tool call
READY_WAIT_S = 20  # how long a request waits for the first MCP connection
MAX_TURNS = 20  # remembered user + assistant turns per conversation
MAX_SESSIONS = 200
SESSION_TTL_S = 3600

MAX_PARAGRAPHS = 8
MAX_SUGGESTIONS = 3
MAX_CARDS = 30
REFUSAL = "Sorry, I can't help with that. I can help with your schedule, your patients and your meeting notes."
NO_ANSWER = "I couldn't put an answer together that time. Please ask again, or narrow it to one day, patient or meeting."
TOO_MANY_STEPS = "That needed too many steps. Try a narrower question, for example one day or one patient."
APPOINTMENT_ID = re.compile(r"\bAPT-\d{4,}\b")
MARKDOWN = re.compile(r"(\*\*|__|`+|^#{1,6}\s+)", re.MULTILINE)


WRITE_PREFIXES = ("edit_", "create_", "update_", "delete_", "add_", "remove_", "set_", "write_", "send_", "move_")


def is_read_only(tool_name: str) -> bool:
    """Wispr Flow tools are named verb_noun; anything that writes is left out."""
    return not tool_name.startswith(WRITE_PREFIXES)


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
            # Samvad only reads Wispr Flow: tools that change data (e.g. edit_memory) are never offered to Claude.
            self.tools = [
                {"name": t.name, "description": t.description or "", "input_schema": t.inputSchema or {"type": "object"}}
                for t in listed.tools
                if is_read_only(t.name)
            ]
            skipped = [t.name for t in listed.tools if not is_read_only(t.name)]
            log.info("Loaded %d Wispr Flow MCP tools: %s", len(self.tools), ", ".join(t["name"] for t in self.tools))
            if skipped:
                log.info("Skipped Wispr Flow tools that change data: %s", ", ".join(skipped))
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
        if not is_read_only(name):  # never offered, but never run either
            return f"{name} is not available.", True
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
    async def meetings_ready(self) -> bool:
        """Whether the Wispr Flow tools can be used; the agent still answers schedule questions without them."""
        try:
            await self.wait_ready()
        except HTTPException:
            return False
        return True

    async def _run_tool(self, name: str, args: dict, native: SamvadTools) -> tuple[str, bool]:
        if name in samvad_tools.NAMES:
            return await native.call(name, args)
        try:
            return await self.call_tool(name, args)
        except HTTPException as exc:  # Wispr Flow dropped mid-conversation: tell Claude, keep going
            detail = exc.detail.get("message") if isinstance(exc.detail, dict) else exc.detail
            return f"Meetings and notes are unavailable: {detail}", True

    async def query(self, user_id: str, token: str, body: AgentQueryIn) -> AgentQueryOut:
        s = get_settings()
        client = bedrock()  # 503 when Bedrock isn't configured
        meetings = await self.meetings_ready()
        native = SamvadTools(user_id=user_id, token=token)
        tools = [*samvad_tools.TOOLS, *(self.tools if meetings else [])]
        tool_names = {t["name"] for t in tools}
        system = [
            # Tools + this block are identical on every call, so that prefix is cached.
            {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": context_block(today_line(_now(s.google_calendar_timezone)), body.language, meetings)},
        ]

        history = self._history((user_id, body.session_id))
        messages: list[dict] = [*history, {"role": "user", "content": body.query}]
        answer: dict[str, Any] | None = None
        fallback = ""
        try:
            for _ in range(MAX_STEPS):
                response = await client.messages.create(
                    model=s.bedrock_model,
                    max_tokens=16000,  # room for adaptive thinking plus a long meeting recap
                    system=system,
                    tools=tools,
                    thinking={"type": "adaptive"},
                    messages=messages,
                )
                if response.stop_reason == "max_tokens":
                    log.warning("Agent answer hit max_tokens")
                    fallback = NO_ANSWER
                    break
                if response.stop_reason == "refusal":
                    answer = {"paragraphs": [REFUSAL]}
                    break
                calls = [b for b in response.content if b.type == "tool_use"]
                final = next((c for c in calls if c.name == ANSWER_TOOL), None)
                if final is not None:
                    answer = final.input if isinstance(final.input, dict) else {}
                    break
                texts = [b.text.strip() for b in response.content if b.type == "text" and b.text.strip()]
                if texts:
                    fallback = "\n\n".join(texts)
                if response.stop_reason != "tool_use" or not calls:
                    break

                messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in response.content]})
                # Lookups Claude asked for together run in parallel.
                outcomes = await asyncio.gather(*(self._run_tool(c.name, c.input, native) for c in calls))
                messages.append({
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": c.id, "content": text, "is_error": is_error}
                        for c, (text, is_error) in zip(calls, outcomes)
                    ],
                })
            else:
                fallback = fallback or TOO_MANY_STEPS
        except RateLimitError:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "The assistant is busy, try again in a moment") from None
        except APIStatusError as exc:
            log.warning("Bedrock error %s", exc.status_code)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The assistant could not answer, try again") from None
        except APIConnectionError:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not reach the assistant model") from None

        out = build_reply(body.session_id, answer, fallback, native.found, tool_names)
        history += [{"role": "user", "content": body.query}, {"role": "assistant", "content": out.response}]
        del history[:-MAX_TURNS]
        return out


def _now(timezone: str) -> dt.datetime:
    try:
        return dt.datetime.now(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        return dt.datetime.now(dt.UTC)


def _as_list(value: Any) -> list | None:
    """A list field of the answer tool; models sometimes send it as a JSON string or a single string."""
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except ValueError:
            return re.split(r"\n\s*\n", value)
        return parsed if isinstance(parsed, list) else [str(parsed)]
    return None


def _clean(text: Any, tool_names: set[str]) -> str:
    """Plain text for the page: no markdown, no internal tool names."""
    text = MARKDOWN.sub("", str(text)).strip()
    return humanize_tool_names(text, tool_names)


def build_reply(
    session_id: str,
    answer: dict[str, Any] | None,
    fallback: str,
    found: dict[str, Appointment],
    tool_names: set[str],
) -> AgentQueryOut:
    """The page's reply from Claude's answer (or its plain text when it skipped the answer tool)."""
    answer = answer or {}
    raw = _as_list(answer.get("paragraphs"))
    if not raw:
        raw = re.split(r"\n\s*\n", fallback) if fallback else [NO_ANSWER]
    paragraphs = [p for p in (_clean(x, tool_names) for x in raw) if p][:MAX_PARAGRAPHS] or [NO_ANSWER]
    if paragraphs == [NO_ANSWER]:
        log.warning("Agent finished without an answer (answer keys: %s)", sorted(answer))

    ids = _as_list(answer.get("appointment_ids"))
    if ids is None:
        ids = APPOINTMENT_ID.findall(" ".join(paragraphs))
    # Only appointments a lookup returned this turn: never a card for an id Claude made up.
    shown = list(dict.fromkeys(str(i) for i in ids if str(i) in found))[:MAX_CARDS]

    suggestions = [_clean(x, tool_names)[:120] for x in _as_list(answer.get("suggestions")) or []]
    return AgentQueryOut(
        session_id=session_id,
        response="\n\n".join(paragraphs),
        paragraphs=paragraphs,
        appointment_ids=shown,
        appointments=[found[i] for i in shown],
        suggestions=[x for x in suggestions if x][:MAX_SUGGESTIONS],
    )


wispr_agent = WisprAgent()
