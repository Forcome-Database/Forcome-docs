import pytest

from app.agent.cancellation import (
    AgentCancelledError,
    cancel_task,
    cancellable,
    register_task,
    unregister_task,
)


@pytest.mark.asyncio
async def test_cancellable_wrapper_raises_after_task_cancelled():
    register_task("task-1", "thread-1")
    cancel_task("task-1")

    async def node(state):
        return {"ok": True}

    wrapped = cancellable(node)

    with pytest.raises(AgentCancelledError):
        await wrapped({"_task_id": "task-1", "_thread_id": "thread-1"})

    unregister_task("task-1", "thread-1")


def test_cancel_task_returns_false_for_unknown_task():
    assert cancel_task("missing-task") is False
