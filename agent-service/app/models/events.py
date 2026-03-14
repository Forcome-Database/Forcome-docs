from __future__ import annotations
from typing import Literal, Any
from pydantic import BaseModel


class StepEvent(BaseModel):
    type: Literal["step_start", "step_done"]
    step_name: str
    description: str = ""
    result_summary: str = ""


class ContentEvent(BaseModel):
    type: Literal["content_delta", "content_cleared"]
    chunk: str = ""
    section_id: str | None = None


class InteractionEvent(BaseModel):
    type: Literal["await_user_input"]
    phase: Literal["brief", "blueprint", "review"]
    data: dict[str, Any]


class SectionProgressEvent(BaseModel):
    type: Literal["section_progress"]
    current: int
    total: int
    section_title: str = ""


class CompletionEvent(BaseModel):
    type: Literal["done", "error", "cancelled"]
    final_content: str = ""
    error_message: str = ""


class ComplexityEvent(BaseModel):
    type: Literal["complexity_analyzed"]
    level: int
    reasoning: str = ""


# Union type for all SSE events
SSEEvent = StepEvent | ContentEvent | InteractionEvent | SectionProgressEvent | CompletionEvent | ComplexityEvent


def serialize_event(event: SSEEvent) -> str:
    """Serialize an SSE event to JSON string for streaming."""
    return event.model_dump_json()
