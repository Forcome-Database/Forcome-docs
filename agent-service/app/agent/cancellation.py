import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.agent.state import AgentState


class AgentCancelledError(Exception):
    """Raised when a running agent task has been cancelled."""


_cancel_events_by_task: dict[str, asyncio.Event] = {}
_cancel_events_by_thread: dict[str, asyncio.Event] = {}


def register_task(task_id: str, thread_id: str) -> asyncio.Event:
    event = asyncio.Event()
    _cancel_events_by_task[task_id] = event
    _cancel_events_by_thread[thread_id] = event
    return event


def unregister_task(task_id: str, thread_id: str) -> None:
    _cancel_events_by_task.pop(task_id, None)
    _cancel_events_by_thread.pop(thread_id, None)


def cancel_task(task_id: str) -> bool:
    event = _cancel_events_by_task.get(task_id)
    if event is None:
        return False

    event.set()
    return True


def is_task_cancelled(task_id: str | None, thread_id: str | None) -> bool:
    event = None
    if thread_id:
        event = _cancel_events_by_thread.get(thread_id)
    if event is None and task_id:
        event = _cancel_events_by_task.get(task_id)
    if event is None:
        return False

    return event.is_set()


async def raise_if_cancelled(state: AgentState | dict[str, Any]) -> None:
    if is_task_cancelled(state.get("_task_id"), state.get("_thread_id")):
        raise AgentCancelledError(state.get("_task_id", ""))


def cancellable(
    node_fn: Callable[[AgentState], Awaitable[dict]],
) -> Callable[[AgentState], Awaitable[dict]]:
    async def wrapper(state: AgentState) -> dict:
        await raise_if_cancelled(state)
        return await node_fn(state)

    return wrapper
