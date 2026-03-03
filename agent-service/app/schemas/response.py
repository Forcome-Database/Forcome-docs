from typing import Any, Literal

from pydantic import BaseModel, Field


class StepStartEvent(BaseModel):
    type: Literal["step_start"] = "step_start"
    step_id: str
    step_name: str
    message: str | None = None


class StepDoneEvent(BaseModel):
    type: Literal["step_done"] = "step_done"
    step_id: str
    message: str | None = None


class ContentEvent(BaseModel):
    type: Literal["content"] = "content"
    content: str


class ImageEvent(BaseModel):
    type: Literal["image"] = "image"
    image_url: str
    alt_text: str | None = None


class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    output: Any | None = None


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str
    code: str | None = None


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    run_id: str
    success: bool = True


SSEEvent = (
    StepStartEvent
    | StepDoneEvent
    | ContentEvent
    | ImageEvent
    | ToolCallEvent
    | ErrorEvent
    | DoneEvent
)
