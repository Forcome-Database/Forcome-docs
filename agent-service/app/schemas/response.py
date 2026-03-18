from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.models.blueprint import CreationBlueprint
from app.models.brief import CreationBrief
from app.models.review import ReviewReport
from app.schemas.document_contracts import DocumentArtifact


class ClarifyAwaitInputData(BaseModel):
    type: Literal["clarify"] = "clarify"
    questions: list[str]


class ProposalOption(BaseModel):
    title: str
    description: str


class ProposeAwaitInputData(BaseModel):
    type: Literal["propose"] = "propose"
    proposals: list[ProposalOption]


class OutlineArtifactPlanItem(BaseModel):
    section_id: str
    section_title: str
    artifacts: list[DocumentArtifact] = Field(default_factory=list)


class OutlineAwaitInputData(BaseModel):
    type: Literal["outline"] = "outline"
    outline: str
    artifact_plan: list[OutlineArtifactPlanItem] = Field(default_factory=list)


class BriefAssetSummary(BaseModel):
    images: int = 0
    tables: int = 0
    code: int = 0
    text: int = 0
    source_word_count: int = 0
    source_section_counts: dict[str, int] = Field(default_factory=dict)


class BriefAwaitInputData(BaseModel):
    type: Literal["brief"] = "brief"
    brief: CreationBrief
    asset_summary: BriefAssetSummary = Field(default_factory=BriefAssetSummary)


class BlueprintAwaitInputData(BaseModel):
    type: Literal["blueprint"] = "blueprint"
    blueprint: CreationBlueprint


class ReviewAwaitInputData(BaseModel):
    type: Literal["review"] = "review"
    report: ReviewReport


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


class ContentClearEvent(BaseModel):
    type: Literal["content_clear"] = "content_clear"


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

class BlockedEvent(BaseModel):
    type: Literal["blocked"] = "blocked"
    message: str

class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    final_content: str
    insert_mode: str = "create"

class AwaitInputEvent(BaseModel):
    type: Literal["await_input"] = "await_input"
    phase: Literal["clarify", "propose", "outline", "brief", "blueprint", "review"]
    data: (
        ClarifyAwaitInputData
        | ProposeAwaitInputData
        | OutlineAwaitInputData
        | BriefAwaitInputData
        | BlueprintAwaitInputData
        | ReviewAwaitInputData
        | dict[str, Any]
    )

    @model_validator(mode="after")
    def validate_phase_data_match(self):
        if isinstance(self.data, BaseModel):
            if self.phase != self.data.type:
                raise ValueError(
                    f"await_input phase '{self.phase}' does not match data.type '{self.data.type}'"
                )
        return self

class SectionProgressEvent(BaseModel):
    type: Literal["section_progress"] = "section_progress"
    current: int
    total: int
    section_title: str = ""


class ComplexityAnalyzedEvent(BaseModel):
    type: Literal["complexity_analyzed"] = "complexity_analyzed"
    level: int
    reasoning: str = ""


class FixAppliedEvent(BaseModel):
    type: Literal["fix_applied"] = "fix_applied"
    issue_id: str
    section_id: str | None = None
    success: bool = True


class SessionEvent(BaseModel):
    type: Literal["session"] = "session"
    thread_id: str


class CancelledEvent(BaseModel):
    type: Literal["cancelled"] = "cancelled"

SSEEvent = StepStartEvent | StepDoneEvent | ContentEvent | ContentClearEvent | ImageEvent | ToolCallEvent | ErrorEvent | BlockedEvent | DoneEvent | AwaitInputEvent | SectionProgressEvent | ComplexityAnalyzedEvent | FixAppliedEvent | SessionEvent | CancelledEvent
