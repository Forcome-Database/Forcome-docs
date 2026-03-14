from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field

from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint
from app.models.draft import SectionDraft
from app.models.review import ReviewReport


class CreationState(BaseModel):
    """Unified state container for the entire creation process."""

    # User input
    user_message: str = ""
    conversation_history: list[dict] = Field(default_factory=list)
    uploaded_files: list[dict] = Field(default_factory=list)
    template_id: str | None = None
    system_prompt: str | None = None
    template_prompt: str | None = None

    # Task analysis
    complexity_level: Literal[1, 2, 3] = 3

    # Structured intermediates
    brief: CreationBrief | None = None
    asset_map: AssetMap | None = None
    blueprint: CreationBlueprint | None = None
    section_drafts: list[SectionDraft] = Field(default_factory=list)
    review_report: ReviewReport | None = None

    # Page context
    page_id: str | None = None
    page_title: str | None = None
    page_content: str | None = None
    selected_text: str | None = None
    workspace_id: str = ""

    # Progress
    phase: str = "init"
    final_content: str = ""
    task_id: str = ""
    thread_id: str = ""
