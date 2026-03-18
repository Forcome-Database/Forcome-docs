from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, field_validator

VALID_CATEGORIES = {"length", "structure", "content", "style", "asset", "visual", "format"}

# Map common LLM-generated categories to valid ones
_CATEGORY_ALIASES: dict[str, str] = {
    "readability": "style",
    "consistency": "style",
    "grammar": "style",
    "spelling": "style",
    "tone": "style",
    "coherence": "content",
    "completeness": "content",
    "accuracy": "content",
    "relevance": "content",
    "citation": "asset",
    "reference": "asset",
    "image": "visual",
    "diagram": "visual",
    "layout": "format",
    "formatting": "format",
    "heading": "structure",
    "organization": "structure",
    "word_count": "length",
    "budget": "length",
}


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

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v: str) -> str:
        if v in VALID_CATEGORIES:
            return v
        return _CATEGORY_ALIASES.get(v, "content")

    @field_validator("severity", mode="before")
    @classmethod
    def normalize_severity(cls, v: str) -> str:
        if v in ("error", "warning", "info"):
            return v
        v_lower = v.lower() if isinstance(v, str) else ""
        if v_lower in ("critical", "high", "major"):
            return "error"
        if v_lower in ("medium", "moderate", "low"):
            return "warning"
        return "info"


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
