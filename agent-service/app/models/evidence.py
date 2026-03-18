from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


EvidenceKind = Literal[
    "uploaded_document",
    "uploaded_image",
    "page_context",
    "reference_url",
    "web_search",
]
EvidenceStatus = Literal["pending", "success", "failed"]


class EvidenceItem(BaseModel):
    kind: EvidenceKind
    source: str
    required: bool = True
    status: EvidenceStatus = "pending"
    purpose: str
    error: str | None = None


class EvidenceSummary(BaseModel):
    total: int = 0
    required_total: int = 0
    optional_total: int = 0
    failed_required: int = 0


def summarize_evidence(items: list[EvidenceItem]) -> EvidenceSummary:
    return EvidenceSummary(
        total=len(items),
        required_total=sum(1 for item in items if item.required),
        optional_total=sum(1 for item in items if not item.required),
        failed_required=sum(
            1 for item in items if item.required and item.status == "failed"
        ),
    )
