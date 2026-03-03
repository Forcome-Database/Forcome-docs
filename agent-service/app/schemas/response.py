from pydantic import BaseModel
from typing import Literal

class StepStartEvent(BaseModel):
    type: Literal["step_start"] = "step_start"
    step: str
    description: str

class StepDoneEvent(BaseModel):
    type: Literal["step_done"] = "step_done"
    step: str
    result_summary: str

class ContentEvent(BaseModel):
    type: Literal["content"] = "content"
    chunk: str

class ImageEvent(BaseModel):
    type: Literal["image"] = "image"
    url: str
    alt: str

class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    tool: str
    args: dict = {}

class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str

class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    final_content: str
    insert_mode: str = "create"

SSEEvent = StepStartEvent | StepDoneEvent | ContentEvent | ImageEvent | ToolCallEvent | ErrorEvent | DoneEvent
