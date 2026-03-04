from typing import TypedDict, Literal

class PlanStep(TypedDict):
    step_id: int
    action: str           # "search" | "parse" | "crawl" | "generate" | "image" | "annotate" | "review"
    description: str
    tool: str | None
    args: dict | None
    status: str           # "pending" | "running" | "done" | "skipped"

class AgentState(TypedDict):
    # User input
    user_message: str
    conversation_history: list[dict]
    uploaded_files: list[dict]
    template_id: str | None

    # Document context
    page_id: str | None
    page_title: str | None
    page_content: str | None
    selected_text: str | None
    selection_range: dict | None
    insert_mode: str  # "create" | "overwrite" | "replace" | "append"

    # Agent working state
    plan: list[PlanStep]
    current_step: int
    research_results: list[dict]
    parsed_files: list[dict]
    generated_images: list[dict]

    # Output
    draft_content: str
    final_content: str
    step_events: list[dict]

    # Phase artifacts
    clarify_questions: list[str]
    user_answers: str
    proposals: list[dict]          # [{title, description}]
    selected_proposal: dict
    outline: str
    confirmed_outline: str

    # Control
    phase: str                     # "explorer" | "clarifier" | "proposer" | "outliner" | "writer" | "reviewer"
    needs_revision: bool
    revision_feedback: str
    iteration_count: int
    max_iterations: int

    # Internal (event routing)
    _task_id: str
    _thread_id: str
