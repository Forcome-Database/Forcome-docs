from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.document_contracts import AiDocumentStrategy

class FileInfo(BaseModel):
    filename: str
    mimetype: str
    content_b64: str

class PageContext(BaseModel):
    page_id: str | None = None
    page_title: str | None = None
    page_content: str | None = None
    selected_text: str | None = None
    selection_range: dict | None = None


class EvidenceRequirement(BaseModel):
    type: Literal[
        "reference_url",
        "uploaded_document",
        "uploaded_image",
        "page_context",
        "web_search",
    ]
    required: bool = True
    url: str | None = None
    fileName: str | None = None
    pageId: str | None = None
    missing: bool = False

class AgentRunRequest(BaseModel):
    user_message: str
    files: list[FileInfo] = Field(default_factory=list)
    page_context: PageContext = Field(default_factory=PageContext)
    evidence_items: list[EvidenceRequirement] = Field(default_factory=list)
    template_id: str | None = None
    system_prompt: str | None = None
    template_prompt: str | None = None
    document_strategy: AiDocumentStrategy = Field(default_factory=dict)
    conversation_history: list[dict] = Field(default_factory=list)
    workspace_id: str = ""
    config: dict = Field(default_factory=dict)
    thread_id: str | None = None
    intent_route: Literal["selection_edit", "document_transform", "document_create"] = "document_create"
    scope: Literal["selection", "uploaded_document", "current_page", "blank_page"] = "blank_page"
    source_policy: Literal["preserve_source", "transform_source", "create_new"] = "create_new"
    length_policy: Literal["preserve", "compress", "expand"] = "preserve"
    prioritize_user_instructions: bool = True


class ClarifyResumeValue(BaseModel):
    answers: str


class ProposeResumeValue(BaseModel):
    selected_proposal: int
    feedback: str | None = None


class OutlineConfirmResumeValue(BaseModel):
    action: Literal["confirm"]
    confirmed_outline: str


class OutlineRegenerateResumeValue(BaseModel):
    action: Literal["regenerate"]
    feedback: str | None = None


class BriefResumeValue(BaseModel):
    type: Literal["brief"] = "brief"
    brief: dict


class BlueprintResumeValue(BaseModel):
    type: Literal["blueprint"] = "blueprint"
    blueprint: dict | None = None


class ReviewResumeValue(BaseModel):
    type: Literal["review"] = "review"
    selected_issue_ids: list[str] = Field(default_factory=list)
    feedback: str | None = None
    skip: bool = False


AgentResumeValue = (
    ClarifyResumeValue
    | ProposeResumeValue
    | OutlineConfirmResumeValue
    | OutlineRegenerateResumeValue
    | BriefResumeValue
    | BlueprintResumeValue
    | ReviewResumeValue
)


class AgentResumeRequest(BaseModel):
    thread_id: str
    resume_value: AgentResumeValue

class AgentStopRequest(BaseModel):
    task_id: str
