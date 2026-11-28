"""One long-lived MCP client session, shared by every request.

Opening a streamable-HTTP MCP session costs an `initialize` handshake (about 3.5 s
against Wispr Flow); a call over an open session costs about 0.3 s. So an owner task
opens the session once and holds it until it is closed or breaks, and requests send
calls over it concurrently. anyio requires the transport's context managers to be
entered and exited in the same task, which is why a dedicated owner task holds them.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

log = logging.getLogger("samvad.mcp")

HTTP_TIMEOUT_S = 30  # connect / plain HTTP requests
SSE_READ_TIMEOUT_S = 300  # a streamed response may stay open this long
CLOSE_TIMEOUT_S = 5


def root_cause(e: BaseException) -> BaseException:
    """Unwrap ExceptionGroups (anyio wraps transport errors) so the real error is reported."""
    while isinstance(e, BaseExceptionGroup) and e.exceptions:
        e = e.exceptions[0]
    return e


class McpConnection:
    def __init__(self, url: str, auth: httpx.Auth | None) -> None:
        self.url = url
        self.auth = auth
        self._session: ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._stop: asyncio.Event | None = None
        self._lock = asyncio.Lock()

    @property
    def is_open(self) -> bool:
        return self._session is not None and self._task is not None and not self._task.done()

    async def session(self) -> ClientSession:
        """The open session, opening it first if needed (concurrent callers share one open)."""
        if not self.is_open:
            async with self._lock:
                if not self.is_open:
                    await self._open()
        assert self._session is not None
        return self._session

    async def _open(self) -> None:
        ready: asyncio.Future = asyncio.get_running_loop().create_future()
        self._stop = asyncio.Event()
        self._task = asyncio.create_task(self._run(ready, self._stop), name="wispr-mcp-session")
        await ready  # raises the connection error, if any

    async def _run(self, ready: asyncio.Future, stop: asyncio.Event) -> None:
        opened: ClientSession | None = None
        try:
            async with streamablehttp_client(
                self.url, auth=self.auth, timeout=HTTP_TIMEOUT_S, sse_read_timeout=SSE_READ_TIMEOUT_S
            ) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    self._session = opened = session
                    ready.set_result(None)
                    log.info("Wispr Flow MCP session opened")
                    await stop.wait()
        except asyncio.CancelledError:
            if not ready.done():
                ready.cancel()
            raise
        except BaseException as e:
            if not ready.done():
                ready.set_exception(root_cause(e))
            else:
                log.warning("Wispr Flow MCP session ended: %s", type(root_cause(e)).__name__)
        finally:
            if self._session is opened:  # never clear a newer session opened after close()
                self._session = None

    async def close(self) -> None:
        """Close the session; the next call opens a new one."""
        task, stop = self._task, self._stop
        self._session, self._task = None, None
        if stop:
            stop.set()
        if task and not task.done():
            try:
                await asyncio.wait_for(task, timeout=CLOSE_TIMEOUT_S)
            except Exception:  # a slow or failing close must not break the caller
                task.cancel()
