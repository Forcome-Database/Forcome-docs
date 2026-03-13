from typing import Literal

from pydantic import BaseModel, model_validator


class ClarifyAwaitInputData(BaseModel):
    type: Literal["clarify"] = "clarify"
    questions: list[str]


class ProposalOption(BaseModel):
    title: str
    description: str


class ProposeAwaitInputData(BaseModel):
    type: Literal["propose"] = "propose"
    proposals: list[ProposalOption]


class OutlineAwaitInputData(BaseModel):
    type: Literal["outline"] = "outline"
    outline: str

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

class AwaitInputEvent(BaseModel):
    type: Literal["await_input"] = "await_input"
    phase: Literal["clarify", "propose", "outline"]
    data: ClarifyAwaitInputData | ProposeAwaitInputData | OutlineAwaitInputData

    @model_validator(mode="after")
    def validate_phase_data_match(self):
        if self.phase != self.data.type:
            raise ValueError(
                f"await_input phase '{self.phase}' does not match data.type '{self.data.type}'"
            )
        return self

class SessionEvent(BaseModel):
    type: Literal["session"] = "session"
    thread_id: str


class CancelledEvent(BaseModel):
    type: Literal["cancelled"] = "cancelled"

SSEEvent = StepStartEvent | StepDoneEvent | ContentEvent | ImageEvent | ToolCallEvent | ErrorEvent | DoneEvent | AwaitInputEvent | SessionEvent | CancelledEvent
