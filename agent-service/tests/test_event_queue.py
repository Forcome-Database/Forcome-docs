import pytest

from app.agent.events import create_queue, emit, emit_done, remove_queue


@pytest.mark.asyncio
async def test_emit_validates_and_normalizes_typed_sse_event():
    queue = create_queue("thread-queue-1")

    await emit(
        "thread-queue-1",
        {
            "type": "await_input",
            "phase": "clarify",
            "data": {
                "type": "clarify",
                "questions": ["What environment should this cover?"],
            },
        },
    )

    event = await queue.get()

    assert event == {
        "type": "await_input",
        "phase": "clarify",
        "data": {
            "type": "clarify",
            "questions": ["What environment should this cover?"],
        },
    }

    await emit_done("thread-queue-1")
    assert await queue.get() is None
    remove_queue("thread-queue-1")


@pytest.mark.asyncio
async def test_emit_rejects_invalid_sse_event_payload():
    create_queue("thread-queue-2")

    with pytest.raises(Exception):
        await emit(
            "thread-queue-2",
            {
                "type": "await_input",
                "phase": "outline",
                "data": {"type": "clarify", "questions": ["wrong shape"]},
            },
        )

    remove_queue("thread-queue-2")
