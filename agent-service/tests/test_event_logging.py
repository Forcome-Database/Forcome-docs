import logging

import pytest

from app.agent.events import create_queue, emit, remove_queue


@pytest.mark.asyncio
async def test_emit_logs_high_signal_step_events(caplog):
    thread_id = "thread-log-1"
    create_queue(thread_id)
    caplog.set_level(logging.INFO, logger="uvicorn.error")

    try:
        await emit(
            thread_id,
            {
                "type": "step_start",
                "step": "write_section_s1",
                "description": "Writing: Intro",
            },
        )
    finally:
        remove_queue(thread_id)

    assert any(
        "thread_id=thread-log-1" in record.message
        and "step_start" in record.message
        and "write_section_s1" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_emit_logs_section_state_events_with_structured_fields(caplog):
    thread_id = "thread-log-2"
    create_queue(thread_id)
    caplog.set_level(logging.INFO, logger="uvicorn.error")

    try:
        await emit(
            thread_id,
            {
                "type": "section_state",
                "section_id": "s1",
                "write_attempts": 2,
                "image_status": "generated",
                "source_image_asset_id": "img-source-1",
                "degraded_reason": "source asset unavailable",
            },
        )
    finally:
        remove_queue(thread_id)

    assert any(
        "thread_id=thread-log-2" in record.message
        and "event=section_state" in record.message
        and "section_id=s1" in record.message
        and "write_attempts=2" in record.message
        and "image_status=generated" in record.message
        for record in caplog.records
    )
