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
    "uploaded_plus_current_page",
    "current_page",
    "blank_page",
)

DOCUMENT_TASK_MODES = (
    "strict_preservation",
    "relaxed_optimization",
)

DOCUMENT_TASK_STATUSES = (
    "idle",
    "analyzing",
    "awaiting_plan_confirmation",
    "generating_diff",
    "awaiting_review",
    "ready_to_apply",
    "applied",
    "error",
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
    "uploaded_plus_current_page",
    "current_page",
    "blank_page",
]

DocumentTaskMode: TypeAlias = Literal[
    "strict_preservation",
    "relaxed_optimization",
]

DocumentTaskStatus: TypeAlias = Literal[
    "idle",
    "analyzing",
    "awaiting_plan_confirmation",
    "generating_diff",
    "awaiting_review",
    "ready_to_apply",
    "applied",
    "error",
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
    documentTaskMode: DocumentTaskMode | None
    documentSourceScope: Literal[
        "uploaded_document",
        "current_page",
        "uploaded_plus_current_page",
    ] | None
    taskSummarySource: Literal["structured_summary"]
    includeRawHistory: bool
    guardrails: DocumentTaskGuardrails


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
    review_defaults: dict[str, object]


class DocumentTaskGuardrails(TypedDict):
    preserve_meaning: bool
    preserve_image_text_correspondence: bool


class DocumentTaskSummary(TypedDict, total=False):
    summary_source: Literal["structured_summary"]
    include_raw_history: bool
    summary: str


class DocumentTaskTextDiff(TypedDict):
    granularity: Literal["text"]
    format: Literal["line"]


class DocumentTaskDiffEntry(TypedDict, total=False):
    diff_id: str
    block_id: str
    granularity: Literal["block"]
    text_diff: DocumentTaskTextDiff


class DocumentTaskContract(TypedDict, total=False):
    task_id: str
    task_type: DocumentIntentRoute
    source_scope: Literal[
        "uploaded_document",
        "current_page",
        "uploaded_plus_current_page",
    ]
    mode: DocumentTaskMode
    deep_collaboration_enabled: bool
    status: DocumentTaskStatus
    task_summary: DocumentTaskSummary
    diff_set: list[DocumentTaskDiffEntry]
    guardrails: DocumentTaskGuardrails
