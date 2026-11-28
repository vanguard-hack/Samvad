import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData

from app.api.dependencies import current_user
from app.core import mcp_connection, wispr_auth
from app.main import app
from app.services import samvad_agent_service
from app.services.samvad_agent_service import wispr_agent

client = TestClient(app)


@pytest.fixture
def signed_in():
    app.dependency_overrides[current_user] = lambda: "doctor-1"
    yield
    app.dependency_overrides.clear()


# ---- routes ----

def test_samvad_agent_needs_sign_in():
    assert client.post("/api/samvad-agent/query", json={"query": "hi"}).status_code == 401
    assert client.get("/api/samvad-agent/tools").status_code == 401
    assert client.get("/api/samvad-agent/auth/status").status_code == 401
    assert client.post("/api/samvad-agent/auth/retry").status_code == 401
    assert client.post("/api/samvad-agent/auth/reset").status_code == 401


def test_oauth_callback_without_sign_in_in_progress():
    assert client.get("/api/samvad-agent/oauth/callback", params={"code": "x", "state": "y"}).status_code == 409
    assert client.get("/api/samvad-agent/oauth/callback").status_code == 400
    r = client.get("/api/samvad-agent/oauth/callback", params={"error": "<script>"})
    assert r.status_code == 400 and "<script>" not in r.text


def test_query_returns_sign_in_url_when_wispr_not_connected(monkeypatch, signed_in):
    monkeypatch.setattr(samvad_agent_service, "bedrock", lambda: SimpleNamespace())
    monkeypatch.setattr(wispr_agent, "ready", False)
    monkeypatch.setattr(wispr_agent, "start", lambda: None)
    monkeypatch.setattr(wispr_agent.bridge, "pending_auth_url", "https://wispr.example/authorize?x=1")
    r = client.post("/api/samvad-agent/query", json={"query": "hi"})
    assert r.status_code == 503
    assert r.json()["detail"]["auth_url"] == "https://wispr.example/authorize?x=1"


# ---- agent loop with a fake Bedrock client ----

def _block(**kw):
    return SimpleNamespace(**kw, model_dump=lambda **_: dict(kw))


class FakeMessages:
    """Turn 1: two tool calls at once. Turn 2: one more (multi-step). Turn 3: the answer."""

    def __init__(self):
        self.calls = []

    async def create(self, **kw):
        self.calls.append(kw)
        n = len(self.calls)
        if n == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[
                _block(type="tool_use", id="t1", name="search_meetings", input={"limit": 1}),
                _block(type="tool_use", id="t2", name="list_folders", input={}),
            ])
        if n == 2:
            return SimpleNamespace(stop_reason="tool_use", content=[
                _block(type="tool_use", id="t3", name="get_meeting", input={"meeting_id": "m1"}),
            ])
        return SimpleNamespace(stop_reason="end_turn", content=[_block(type="text", text="You had one standup.")])


def test_query_runs_parallel_and_multi_step_tools_and_keeps_history_per_doctor(monkeypatch, signed_in):
    fake = SimpleNamespace(messages=FakeMessages())
    running, peak, tool_calls = 0, 0, []

    async def fake_call_tool(name, args):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.05)
        running -= 1
        tool_calls.append(name)
        return f"{name} result", name == "get_meeting"  # one tool error goes back to Claude

    tools = [{"name": n, "description": "", "input_schema": {"type": "object"}} for n in ("search_meetings", "list_folders", "get_meeting")]
    monkeypatch.setattr(samvad_agent_service, "bedrock", lambda: fake)
    monkeypatch.setattr(wispr_agent, "call_tool", fake_call_tool)
    monkeypatch.setattr(wispr_agent, "ready", True)
    monkeypatch.setattr(wispr_agent, "tools", tools)
    monkeypatch.setattr(wispr_agent, "_sessions", type(wispr_agent._sessions)())

    r = client.post("/api/samvad-agent/query", json={"query": "Any standups?", "session_id": "s1"})

    assert r.status_code == 200
    assert r.json() == {"session_id": "s1", "response": "You had one standup.",
                        "tools_available": ["search_meetings", "list_folders", "get_meeting"]}
    assert sorted(tool_calls) == ["get_meeting", "list_folders", "search_meetings"]
    assert peak == 2  # the two calls from the same turn ran at the same time
    # The loop appends to one list: [query, turn 1, results 1, turn 2, results 2].
    sent = fake.messages.calls[2]["messages"]
    assert [x["tool_use_id"] for x in sent[2]["content"]] == ["t1", "t2"]
    assert sent[4]["content"][0]["tool_use_id"] == "t3" and sent[4]["content"][0]["is_error"] is True
    # History is remembered for this doctor's session only.
    assert wispr_agent._history(("doctor-1", "s1"))[-1] == {"role": "assistant", "content": "You had one standup."}
    assert wispr_agent._history(("doctor-2", "s1")) == []


# ---- tool calls over the shared MCP session ----

class FakeConn:
    def __init__(self, failures):
        self.failures = list(failures)  # exceptions raised by successive calls
        self.closed = 0
        self.calls = 0

    async def session(self):
        return self

    async def call_tool(self, name, args, read_timeout_seconds=None):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return SimpleNamespace(content=[SimpleNamespace(text=f"{name} ok")], isError=False, structuredContent=None)

    async def close(self):
        self.closed += 1


def test_broken_session_is_reopened_and_retried_once(monkeypatch):
    conn = FakeConn([httpx.ConnectError("dropped")])
    monkeypatch.setattr(wispr_agent, "conn", conn)
    assert asyncio.run(wispr_agent.call_tool("list_folders", {})) == ("list_folders ok", False)
    assert conn.calls == 2 and conn.closed == 1


def test_server_errors_and_timeouts_go_back_to_claude_without_retry(monkeypatch):
    conn = FakeConn([McpError(ErrorData(code=-32602, message="unknown tool: nope"))])
    monkeypatch.setattr(wispr_agent, "conn", conn)
    text, is_error = asyncio.run(wispr_agent.call_tool("nope", {}))
    assert is_error and "unknown tool" in text and conn.calls == 1 and conn.closed == 0

    conn = FakeConn([McpError(ErrorData(code=408, message="Timed out"))])
    monkeypatch.setattr(wispr_agent, "conn", conn)
    text, is_error = asyncio.run(wispr_agent.call_tool("get_meeting", {}))
    assert is_error and "timed out" in text and conn.calls == 1


def test_mcp_connection_opens_once_for_concurrent_callers_and_reopens_after_close(monkeypatch):
    opened = []

    @asynccontextmanager
    async def fake_transport(url, **kw):
        opened.append(url)
        await asyncio.sleep(0.05)
        yield "read", "write", lambda: None

    class FakeSession:
        def __init__(self, read, write):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def initialize(self):
            pass

    monkeypatch.setattr(mcp_connection, "streamablehttp_client", fake_transport)
    monkeypatch.setattr(mcp_connection, "ClientSession", FakeSession)

    async def go():
        conn = mcp_connection.McpConnection("https://mcp.example/mcp", None)
        a, b, c = await asyncio.gather(conn.session(), conn.session(), conn.session())
        assert a is b is c and len(opened) == 1
        await conn.close()
        assert not conn.is_open
        await conn.session()
        assert len(opened) == 2
        await conn.close()

    asyncio.run(go())


# ---- stored-token auth ----

def test_stored_token_auth_refreshes_and_saves_rotated_tokens(tmp_path, monkeypatch):
    path = tmp_path / "tokens.json"
    path.write_text(json.dumps({
        "tokens": {"access_token": "old", "refresh_token": "r1", "expires_in": 3600},
        "tokens_saved_at": time.time() - 7200,  # expired an hour ago
        "client_info": {"client_id": "cid"},
        "token_endpoint": "https://auth.example/token",
    }))
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            form = dict(x.split("=") for x in request.content.decode().split("&"))
            assert form["refresh_token"] == "r1" and form["client_id"] == "cid"
            return httpx.Response(200, json={"access_token": "new", "refresh_token": "r2", "expires_in": 3600})
        seen.append(request.headers["Authorization"])
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(wispr_auth.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw))

    async def go():
        auth = wispr_auth.StoredTokenAuth("https://mcp.example/mcp", path)
        async with real_client(transport=transport, auth=auth) as http:
            await http.get("https://mcp.example/mcp")

    asyncio.run(go())
    assert seen == ["Bearer new"]
    saved = json.loads(path.read_text())["tokens"]
    assert saved["access_token"] == "new" and saved["refresh_token"] == "r2"


def test_token_age_falls_back_to_file_mtime(tmp_path):
    path = tmp_path / "tokens.json"
    path.write_text(json.dumps({"tokens": {"access_token": "a", "expires_in": 3600}}))  # no tokens_saved_at
    auth = wispr_auth.StoredTokenAuth("https://mcp.example/mcp", path)
    assert not auth._needs_refresh()
    old = time.time() - 7200
    os.utime(path, (old, old))
    assert auth._needs_refresh()


def test_stored_token_auth_without_refresh_token_asks_for_reset(tmp_path):
    path = tmp_path / "tokens.json"
    path.write_text(json.dumps({"tokens": {"access_token": "old", "expires_in": 10}, "tokens_saved_at": time.time() - 100}))

    async def go():
        auth = wispr_auth.StoredTokenAuth("https://mcp.example/mcp", path)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200)), auth=auth) as http:
            await http.get("https://mcp.example/mcp")

    with pytest.raises(wispr_auth.StoredTokenError, match="auth/reset"):
        asyncio.run(go())


def test_seed_token_file_from_secret(tmp_path):
    secret = json.dumps({"tokens": {"access_token": "a", "refresh_token": "r"}})
    path = tmp_path / "vol" / "tokens.json"  # the volume folder is created if missing
    assert wispr_auth.seed_token_file(path, base64.b64encode(secret.encode()).decode()) is True
    assert json.loads(path.read_text())["tokens"]["access_token"] == "a"
    # Once the file has (possibly refreshed) tokens, the secret never overwrites it.
    path.write_text(json.dumps({"tokens": {"access_token": "rotated"}}))
    assert wispr_auth.seed_token_file(path, secret) is False
    assert json.loads(path.read_text())["tokens"]["access_token"] == "rotated"
    assert wispr_auth.seed_token_file(tmp_path / "x.json", "") is False
    with pytest.raises(wispr_auth.StoredTokenError):
        wispr_auth.seed_token_file(tmp_path / "y.json", "not json")
    with pytest.raises(wispr_auth.StoredTokenError):
        wispr_auth.seed_token_file(tmp_path / "z.json", json.dumps({"tokens": {}}))
