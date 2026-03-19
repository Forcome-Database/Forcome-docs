from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.blueprint import BlueprintChangeAuditEntry, CreationBlueprint
from app.models.brief import CreationBrief
from app.models.document_tree import DocumentTree
from app.models.evidence import EvidenceItem, EvidenceSummary
from app.models.review import ReviewReport


class SessionBlockState(BaseModel):
    kind: str = "general"
    message: str
    required_action: str = ""
    allowed_resolutions: list[str] = Field(default_factory=list)


class SessionDraftSection(BaseModel):
    node_id: str = ""
    section_id: str
    title: str
    level: int = 2
    content: str
    write_attempts: int = 1
    image_status: str = "not_requested"
    source_image_asset_id: str | None = None
    degraded_reason: str | None = None


class CreationSessionSnapshot(BaseModel):
    session_id: str
    thread_id: str
    run_state: Literal[
        "idle",
        "running",
        "awaiting_input",
        "blocked",
        "completed",
        "error",
        "cancelled",
    ] = "idle"
    phase: str = "init"
    pending_decision: dict[str, Any] | None = None
    blocked: SessionBlockState | None = None
    brief: CreationBrief | None = None
    blueprint: CreationBlueprint | None = None
    pending_blueprint_patch: CreationBlueprint | None = None
    blueprint_change_audit: list[BlueprintChangeAuditEntry] = Field(default_factory=list)
    review_report: ReviewReport | None = None
    draft_markdown: str = ""
    draft_sections: list[SessionDraftSection] = Field(default_factory=list)
    document_tree: DocumentTree | None = None
    final_content: str = ""
    last_error: str | None = None
    evidence_summary: EvidenceSummary = Field(default_factory=EvidenceSummary)
    failed_evidence_items: list[EvidenceItem] = Field(default_factory=list)
    block_resolution_choices: list[str] = Field(default_factory=list)
