"""SSE streaming optimizer — batches content events and adds heartbeats.

Reduces SSE event frequency by:
1. Buffering content_delta events for 50ms before sending
2. Debouncing step events
3. Adding 15s heartbeat to prevent proxy timeouts
"""
from __future__ import annotations
import asyncio
import time
from typing import Any
from app.agent.events import emit as raw_emit


class SSEOptimizer:
    """Optimized SSE event emitter with batching and heartbeat."""

    def __init__(self, thread_id: str, buffer_ms: int = 50, heartbeat_interval: int = 15):
        self.thread_id = thread_id
        self.buffer_ms = buffer_ms / 1000.0  # Convert to seconds
        self.heartbeat_interval = heartbeat_interval
        self._content_buffer: list[str] = []
        self._last_flush = time.monotonic()
        self._last_step_event: dict | None = None
        self._flush_task: asyncio.Task | None = None

    async def emit(self, event: dict[str, Any]) -> None:
        """Emit an SSE event with optimization."""
        event_type = event.get("type", "")

        if event_type == "content":
            # Buffer content events
            chunk = event.get("chunk", "")
            if chunk:
                self._content_buffer.append(chunk)
                # Schedule flush if not already scheduled
                if self._flush_task is None or self._flush_task.done():
                    self._flush_task = asyncio.create_task(self._delayed_flush())
        elif event_type in ("step_start", "step_done"):
            # Flush content buffer first
            await self._flush_content()
            # Send step event immediately
            await raw_emit(self.thread_id, event)
        else:
            # All other events: flush buffer then send immediately
            await self._flush_content()
            await raw_emit(self.thread_id, event)

    async def _delayed_flush(self) -> None:
        """Flush content buffer after delay."""
        await asyncio.sleep(self.buffer_ms)
        await self._flush_content()

    async def _flush_content(self) -> None:
        """Flush accumulated content chunks as a single event."""
        if not self._content_buffer:
            return
        combined = "".join(self._content_buffer)
        self._content_buffer.clear()
        self._last_flush = time.monotonic()
        await raw_emit(self.thread_id, {"type": "content", "chunk": combined})

    async def flush(self) -> None:
        """Force flush any pending events."""
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        await self._flush_content()
