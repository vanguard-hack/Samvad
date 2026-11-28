"""Samvad agent: Claude with the Wispr Flow MCP tools (logic in services/samvad_agent_service.py).

Mounted at /api/samvad-agent. All routes need the doctor's Supabase token except the
OAuth callback, which Wispr Flow's sign-in page redirects the browser to; the MCP SDK
checks its `state` against the sign-in it started.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.dependencies import current_user
from app.schemas.samvad_agent import AgentQueryIn, AgentQueryOut
from app.services.samvad_agent_service import wispr_agent

router = APIRouter()


@router.post("/query", response_model=AgentQueryOut)
async def query(body: AgentQueryIn, user: str = Depends(current_user)) -> AgentQueryOut:
    return await wispr_agent.query(user, body)


@router.get("/tools")
async def tools(_user: str = Depends(current_user)) -> dict:
    """Cached tool list from the Wispr Flow MCP server (no model call)."""
    await wispr_agent.wait_ready()
    return {"count": len(wispr_agent.tools), "tools": wispr_agent.tools}


@router.get("/auth/status")
async def auth_status(_user: str = Depends(current_user)) -> dict:
    wispr_agent.start()
    return wispr_agent.status()


@router.post("/auth/retry")
async def auth_retry(_user: str = Depends(current_user)) -> dict:
    """Re-run the connection (e.g. after a timed-out sign-in)."""
    wispr_agent.start()
    return {"connected": wispr_agent.ready, "hint": "GET /api/samvad-agent/auth/status for the sign-in URL"}


@router.post("/auth/reset")
async def auth_reset(_user: str = Depends(current_user)) -> dict:
    """Delete the stored Wispr Flow tokens and start a fresh sign-in."""
    removed = await wispr_agent.reset()
    return {"removed_tokens": removed, "hint": "GET /api/samvad-agent/auth/status for the sign-in URL"}


@router.get("/oauth/callback", response_class=HTMLResponse)
async def oauth_callback(request: Request) -> HTMLResponse:
    params = request.query_params
    if "error" in params:
        wispr_agent.bridge.fail(params.get("error_description") or params["error"])
        return HTMLResponse("<h3>Wispr Flow sign-in failed.</h3>", status_code=400)  # never echo params (XSS)
    code = params.get("code")
    if not code:
        return HTMLResponse("<h3>Missing authorization code.</h3>", status_code=400)
    if not wispr_agent.bridge.complete(code, params.get("state")):
        return HTMLResponse("<h3>No Wispr Flow sign-in in progress. Retry it from Samvad.</h3>", status_code=409)
    return HTMLResponse("<h3>Wispr Flow connected. You can close this tab.</h3>")
