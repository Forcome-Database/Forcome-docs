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

DOCUMENT_INTENT_ROUTES = (
    "selection_edit",
    "document_transform",
    "document_create",
)

DOCUMENT_SCOPES = (
    "selection",
    "uploaded_document",
    "current_page",
    "blank_page",
)

DOCUMENT_SOURCE_POLICIES = (
    "preserve_source",
    "transform_source",
    "create_new",
)

DOCUMENT_LENGTH_POLICIES = (
    "preserve",
    "compress",
    "expand",
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

DocumentIntentRoute: TypeAlias = Literal[
    "selection_edit",
    "document_transform",
    "document_create",
]

DocumentScope: TypeAlias = Literal[
    "selection",
    "uploaded_document",
    "current_page",
    "blank_page",
]

DocumentSourcePolicy: TypeAlias = Literal[
    "preserve_source",
    "transform_source",
    "create_new",
]

DocumentLengthPolicy: TypeAlias = Literal[
    "preserve",
    "compress",
    "expand",
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
    intentRoute: DocumentIntentRoute
    scope: DocumentScope
    sourcePolicy: DocumentSourcePolicy
    lengthPolicy: DocumentLengthPolicy
    prioritizeUserInstructions: bool


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
