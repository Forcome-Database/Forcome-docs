from pydantic import BaseModel

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
    files: list[FileInfo] = []
    page_context: PageContext = PageContext()
    template_id: str | None = None
    conversation_history: list[dict] = []
    workspace_id: str = ""
    config: dict = {}
    thread_id: str | None = None

class AgentResumeRequest(BaseModel):
    thread_id: str
    resume_value: dict

class AgentStopRequest(BaseModel):
    task_id: str
