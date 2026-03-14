from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class ReviewIssue(BaseModel):
    """A single quality issue found during review."""
    id: str
    section_id: str | None = None
    severity: Literal["error", "warning", "info"]
    category: Literal["length", "structure", "content", "style", "asset", "visual", "format"]
    description: str
    suggestion: str = ""
    auto_fixable: bool = False
    fixed: bool = False


class ReviewReport(BaseModel):
    """Structured quality review report."""
    overall_score: int = 0
    length_compliance: float = 0.0
    asset_reuse_rate: float = 0.0
    issues: list[ReviewIssue] = Field(default_factory=list)
    auto_fixed_count: int = 0
    user_decision_needed: list[str] = Field(default_factory=list)

    def pending_issues(self) -> list[ReviewIssue]:
        return [i for i in self.issues if not i.fixed and not i.auto_fixable]

    def auto_fixable_issues(self) -> list[ReviewIssue]:
        return [i for i in self.issues if i.auto_fixable and not i.fixed]
