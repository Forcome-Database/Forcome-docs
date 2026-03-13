from __future__ import annotations

from typing import Literal, TypeAlias

from typing_extensions import TypedDict


DOCUMENT_ARTIFACTS = (
    "table",
    "mermaid",
    "code_block",
    "image",
    "callout",
    "details",
)

DOCUMENT_EVIDENCE_SOURCES = (
    "uploaded_files",
    "page_context",
    "page_read",
    "knowledge_search",
    "web_search",
    "web_crawl",
    "vision",
    "generated_image",
)

DocumentArtifact: TypeAlias = Literal[
    "table",
    "mermaid",
    "code_block",
    "image",
    "callout",
    "details",
]

DocumentEvidenceSource: TypeAlias = Literal[
    "uploaded_files",
    "page_context",
    "page_read",
    "knowledge_search",
    "web_search",
    "web_crawl",
    "vision",
    "generated_image",
]


class AiDocumentStrategy(TypedDict, total=False):
    templateKey: str
    docType: str
    audience: str
    objectives: list[str]
    requiredArtifacts: list[DocumentArtifact]
    optionalArtifacts: list[DocumentArtifact]
    requiredSections: list[str]
    reviewChecks: list[str]
    editorSyntaxHints: list[str]


class AiDocumentPlanSection(TypedDict):
    id: str
    title: str
    goal: str
    artifacts: list[DocumentArtifact]
    must_cover: list[str]
    evidence: list[DocumentEvidenceSource]


class AiDocumentPlan(TypedDict):
    doc_type: str
    audience: str
    required_artifacts: list[DocumentArtifact]
    sections: list[AiDocumentPlanSection]
