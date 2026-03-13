from typing import Literal, TypedDict

from app.schemas.request import EvidenceRequirement


EvidenceKind = Literal[
    "reference_url",
    "uploaded_document",
    "uploaded_image",
    "page_context",
    "web_search",
]
EvidenceStatus = Literal["pending", "success", "failed"]


class EvidenceItem(TypedDict):
    kind: EvidenceKind
    source: str
    required: bool
    status: EvidenceStatus
    missing: bool
    error: str | None


def _source_for_requirement(item: EvidenceRequirement) -> str:
    if item.type == "reference_url":
        return item.url or "reference_url"
    if item.type in {"uploaded_document", "uploaded_image"}:
        return item.fileName or item.type
    if item.type == "page_context":
        return item.pageId or "page_context"
    return "web_search"


def normalize_evidence_items(
    evidence_items: list[EvidenceRequirement],
) -> list[EvidenceItem]:
    normalized: list[EvidenceItem] = []

    for item in evidence_items:
        normalized.append(
            {
                "kind": item.type,
                "source": _source_for_requirement(item),
                "required": item.required,
                "status": "failed" if item.missing else "pending",
                "missing": item.missing,
                "error": "Required evidence was not provided." if item.missing else None,
            }
        )

    return normalized
