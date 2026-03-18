from __future__ import annotations
from pydantic import BaseModel, Field


class SectionDraft(BaseModel):
    """Draft content for a single section."""
    section_id: str
    node_id: str = ""
    content: str = ""
    word_count: int = 0
    budget_compliance: float = 1.0
    assets_used: list[str] = Field(default_factory=list)
    visuals_generated: list[str] = Field(default_factory=list)
