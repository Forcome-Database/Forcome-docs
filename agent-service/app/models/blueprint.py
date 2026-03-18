from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class VisualPlan(BaseModel):
    """Plan for a visual element in a section."""
    type: Literal["mermaid", "ai_image", "reuse_image", "table"]
    description: str = ""
    source_asset_id: str | None = None
    position: Literal["before_section", "after_paragraph", "end_of_section"] = "end_of_section"


class SectionPlan(BaseModel):
    """Plan for a single document section."""
    id: str
    title: str
    level: int = 2
    word_budget: int = 0
    description: str = ""
    assets: list[str] = Field(default_factory=list)
    visuals: list[VisualPlan] = Field(default_factory=list)
    must_cover: list[str] = Field(default_factory=list)


class CreationBlueprint(BaseModel):
    """Complete creation blueprint with sections, visuals, and word budgets."""
    title: str = ""
    sections: list[SectionPlan] = Field(default_factory=list)
    total_word_budget: int = 0
    style_guide: str = ""
    visual_plan_summary: str = ""

    def section_by_id(self, section_id: str) -> SectionPlan | None:
        return next((s for s in self.sections if s.id == section_id), None)

    def validate_word_budgets(self) -> bool:
        total = sum(s.word_budget for s in self.sections)
        if self.total_word_budget == 0:
            return True
        ratio = total / self.total_word_budget
        return 0.9 <= ratio <= 1.1


class BlueprintDeltaAssessment(BaseModel):
    decision: Literal["auto_patch", "reconfirm_blueprint"]
    changes: list[str] = Field(default_factory=list)


class BlueprintChangeAuditEntry(BaseModel):
    decision: Literal["auto_patch", "reconfirm_blueprint"]
    changes: list[str] = Field(default_factory=list)
