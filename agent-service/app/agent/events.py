"""Real-time event queue for SSE streaming.

Each agent run gets its own asyncio.Queue keyed by task_id.
Nodes push events to the queue during execution (not after completion).
The SSE endpoint reads from the queue in real-time.
"""
import asyncio

from pydantic import TypeAdapter

from app.runtime_logging import log_sse_event
from app.schemas.response import SSEEvent

_event_queues: dict[str, asyncio.Queue] = {}
_sse_event_adapter = TypeAdapter(SSEEvent)


def create_queue(task_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _event_queues[task_id] = q
    return q


def remove_queue(task_id: str):
    _event_queues.pop(task_id, None)


async def emit(task_id: str, event: dict):
    """Push an event to the queue for immediate SSE delivery."""
    q = _event_queues.get(task_id)
    if q:
        validated = _sse_event_adapter.validate_python(event)
        log_sse_event(task_id, validated.model_dump())
        await q.put(validated.model_dump())


async def emit_done(task_id: str):
    """Signal that the graph has finished (sentinel)."""
    q = _event_queues.get(task_id)
    if q:
        await q.put(None)
