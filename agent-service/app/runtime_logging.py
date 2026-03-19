from __future__ import annotations

import logging
from typing import Any


def get_runtime_logger() -> logging.Logger:
    return logging.getLogger("uvicorn.error")


def _truncate(value: Any, limit: int = 160) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def log_sse_event(thread_id: str, event: dict[str, Any]) -> None:
    logger = get_runtime_logger()
    event_type = str(event.get("type") or "unknown")

    if event_type == "content":
        return

    if event_type == "step_start":
        logger.info(
            "thread_id=%s event=step_start step=%s description=%s",
            thread_id,
            _truncate(event.get("step")),
            _truncate(event.get("description")),
        )
        return

    if event_type == "step_done":
        logger.info(
            "thread_id=%s event=step_done step=%s result=%s",
            thread_id,
            _truncate(event.get("step")),
            _truncate(event.get("result_summary")),
        )
        return

    if event_type == "await_input":
        logger.info(
            "thread_id=%s event=await_input phase=%s",
            thread_id,
            _truncate(event.get("phase")),
        )
        return

    if event_type == "blocked":
        logger.warning(
            "thread_id=%s event=blocked kind=%s message=%s",
            thread_id,
            _truncate(event.get("kind")),
            _truncate(event.get("message")),
        )
        return

    if event_type == "error":
        logger.error(
            "thread_id=%s event=error message=%s",
            thread_id,
            _truncate(event.get("message")),
        )
        return

    if event_type == "image":
        logger.info(
            "thread_id=%s event=image url=%s alt=%s",
            thread_id,
            _truncate(event.get("url")),
            _truncate(event.get("alt")),
        )
        return

    if event_type == "section_progress":
        logger.info(
            "thread_id=%s event=section_progress current=%s total=%s title=%s",
            thread_id,
            _truncate(event.get("current")),
            _truncate(event.get("total")),
            _truncate(event.get("section_title")),
        )
        return

    if event_type == "section_state":
        logger.info(
            "thread_id=%s event=section_state section_id=%s write_attempts=%s image_status=%s source_image_asset_id=%s degraded_reason=%s",
            thread_id,
            _truncate(event.get("section_id")),
            _truncate(event.get("write_attempts")),
            _truncate(event.get("image_status")),
            _truncate(event.get("source_image_asset_id")),
            _truncate(event.get("degraded_reason")),
        )
        return

    if event_type == "draft_patch":
        sections = event.get("sections") or []
        logger.info(
            "thread_id=%s event=draft_patch sections=%s markdown_chars=%s",
            thread_id,
            len(sections) if isinstance(sections, list) else "?",
            len(event.get("markdown") or ""),
        )
        return

    if event_type == "done":
        logger.info(
            "thread_id=%s event=done insert_mode=%s final_chars=%s",
            thread_id,
            _truncate(event.get("insert_mode")),
            len(event.get("final_content") or ""),
        )
        return

    if event_type == "cancelled":
        logger.warning("thread_id=%s event=cancelled", thread_id)
        return

    if event_type == "session":
        logger.info("thread_id=%s event=session", thread_id)
        return

    logger.info(
        "thread_id=%s event=%s payload=%s",
        thread_id,
        event_type,
        _truncate(event),
    )
