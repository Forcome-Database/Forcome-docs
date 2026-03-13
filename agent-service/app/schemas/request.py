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

class AgentRunRequest(BaseModel):
    user_message: str
    files: list[FileInfo] = Field(default_factory=list)
    page_context: PageContext = Field(default_factory=PageContext)
    template_id: str | None = None
    system_prompt: str | None = None
    template_prompt: str | None = None
    document_strategy: AiDocumentStrategy = Field(default_factory=dict)
    conversation_history: list[dict] = Field(default_factory=list)
    workspace_id: str = ""
    config: dict = Field(default_factory=dict)
    thread_id: str | None = None


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


AgentResumeValue = (
    ClarifyResumeValue
    | ProposeResumeValue
    | OutlineConfirmResumeValue
    | OutlineRegenerateResumeValue
)


class AgentResumeRequest(BaseModel):
    thread_id: str
    resume_value: AgentResumeValue

class AgentStopRequest(BaseModel):
    task_id: str
