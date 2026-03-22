from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DocumentTaskSummary(BaseModel):
    summary_source: Literal["structured_summary"] = "structured_summary"
    include_raw_history: bool = False
    summary: str = ""


class DocumentTaskGuardrails(BaseModel):
    preserve_meaning: bool = True
    preserve_image_text_correspondence: bool = True


class DocumentTaskTextDiff(BaseModel):
    granularity: Literal["text"] = "text"
    format: Literal["line"] = "line"


class DocumentTaskDiffEntry(BaseModel):
    diff_id: str
    block_id: str
    granularity: Literal["block"] = "block"
    text_diff: DocumentTaskTextDiff | None = None


class DocumentTask(BaseModel):
    task_id: str = ""
    task_type: Literal[
        "selection_edit",
        "document_transform",
        "document_create",
    ] = "document_transform"
    source_scope: (
        Literal["uploaded_document", "current_page", "uploaded_plus_current_page"]
        | None
    ) = None
    mode: Literal["strict_preservation", "relaxed_optimization"] = (
        "strict_preservation"
    )
    deep_collaboration_enabled: bool = True
    status: Literal[
        "idle",
        "analyzing",
        "awaiting_plan_confirmation",
        "generating_diff",
        "awaiting_review",
        "ready_to_apply",
        "applied",
        "error",
    ] = "idle"
    task_summary: DocumentTaskSummary = Field(default_factory=DocumentTaskSummary)
    diff_set: list[DocumentTaskDiffEntry] = Field(default_factory=list)
    guardrails: DocumentTaskGuardrails = Field(default_factory=DocumentTaskGuardrails)


class DocumentTaskApplyPayload(BaseModel):
    task_id: str
    accepted_diff_ids: list[str] = Field(default_factory=list)
    create_rollback_snapshot: bool = True


class DocumentTaskRollbackPayload(BaseModel):
    task_id: str
    rollback_ref: str


class DocumentTaskEnvelope(BaseModel):
    task: DocumentTask
    apply: DocumentTaskApplyPayload | None = None
    rollback: DocumentTaskRollbackPayload | None = None
