from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


ImageStatus = Literal[
    "not_requested",
    "source_reused",
    "generated",
    "generated_fallback",
    "missing_source",
    "generation_failed",
]


class SectionDraft(BaseModel):
    """Draft content for a single section."""
    section_id: str
    node_id: str = ""
    content: str = ""
    word_count: int = 0
    budget_compliance: float = 1.0
    assets_used: list[str] = Field(default_factory=list)
    visuals_generated: list[str] = Field(default_factory=list)
    write_attempts: int = 1
    image_status: ImageStatus = "not_requested"
    source_image_asset_id: str | None = None
    degraded_reason: str | None = None
