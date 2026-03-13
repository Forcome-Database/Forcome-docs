from __future__ import annotations

import json
from typing import Any

from app.schemas.document_contracts import (
    DOCUMENT_ARTIFACTS,
    DOCUMENT_EVIDENCE_SOURCES,
    AiDocumentPlan,
    AiDocumentPlanSection,
    AiDocumentStrategy,
    DocumentArtifact,
    DocumentEvidenceSource,
)


DEFAULT_EDITOR_HINTS = [
    "Use Markdown tables for comparisons, parameters, matrices, and checklists.",
    "Use fenced code blocks with language tags for code, commands, and configuration.",
    "Use Mermaid code blocks for architecture, process, and sequence diagrams when a diagram clarifies the topic.",
    "Use Docmost callouts with :::info, :::warning, :::danger, or :::success for key notes and risks.",
    "Use :::details blocks for optional supplementary detail, not for mandatory content.",
    "Use Markdown images ![alt](url) when source or generated visuals materially help the reader.",
]

EVIDENCE_SOURCE_ALIASES: dict[str, DocumentEvidenceSource] = {
    "search": "web_search",
    "crawl": "web_crawl",
    "knowledge_base": "knowledge_search",
    "image": "generated_image",
    "image_generation": "generated_image",
}


def _normalize_artifacts(raw_values: Any) -> list[DocumentArtifact]:
    if not isinstance(raw_values, list):
        return []

    normalized: list[DocumentArtifact] = []
    for value in raw_values:
        candidate = str(value).strip()
        if candidate in DOCUMENT_ARTIFACTS and candidate not in normalized:
            normalized.append(candidate)  # type: ignore[arg-type]
    return normalized


def _normalize_evidence_sources(raw_values: Any) -> list[DocumentEvidenceSource]:
    if not isinstance(raw_values, list):
        return []

    normalized: list[DocumentEvidenceSource] = []
    for value in raw_values:
        candidate = EVIDENCE_SOURCE_ALIASES.get(str(value).strip(), str(value).strip())
        if (
            candidate in DOCUMENT_EVIDENCE_SOURCES
            and candidate not in normalized
        ):
            normalized.append(candidate)  # type: ignore[arg-type]
    return normalized


def empty_document_plan(strategy: AiDocumentStrategy | None = None) -> AiDocumentPlan:
    return normalize_document_plan({}, strategy)


def format_document_strategy(strategy: AiDocumentStrategy | dict[str, Any] | None) -> str:
    strategy = strategy or {}
    lines: list[str] = []

    if strategy.get("docType"):
        lines.append(f"Document type: {strategy['docType']}")
    if strategy.get("audience"):
        lines.append(f"Audience: {strategy['audience']}")

    for label, key in (
        ("Objectives", "objectives"),
        ("Required sections", "requiredSections"),
        ("Required artifacts", "requiredArtifacts"),
        ("Optional artifacts", "optionalArtifacts"),
        ("Review checks", "reviewChecks"),
    ):
        values = strategy.get(key) or []
        if not values:
            continue
        lines.append(f"{label}:")
        for value in values:
            lines.append(f"- {value}")

    editor_hints = strategy.get("editorSyntaxHints") or DEFAULT_EDITOR_HINTS
    lines.append("Editor syntax hints:")
    for hint in editor_hints:
        lines.append(f"- {hint}")

    return "\n".join(lines).strip()


def derive_visual_requirements(state: dict[str, Any]) -> list[DocumentArtifact]:
    text = " ".join(
        filter(
            None,
            [
                state.get("user_message", ""),
                json.dumps(state.get("document_strategy") or {}, ensure_ascii=False),
            ],
        )
    ).lower()

    hints: list[str] = []
    if any(token in text for token in ["流程", "架构", "workflow", "sequence", "architecture", "流程图", "时序"]):
        hints.append("mermaid")
    if any(token in text for token in ["对比", "compare", "矩阵", "参数", "checklist", "表格", "表"]):
        hints.append("table")
    if any(token in text for token in ["截图", "image", "图片", "screen", "界面", "示意图"]):
        hints.append("image")
    if any(token in text for token in ["代码", "script", "命令", "sql", "api", "curl", "yaml", "json"]):
        hints.append("code_block")
    return [artifact for artifact in DOCUMENT_ARTIFACTS if artifact in hints]


def normalize_document_plan(
    raw: Any,
    strategy: AiDocumentStrategy | dict[str, Any] | None = None,
) -> AiDocumentPlan:
    strategy = strategy or {}
    required_sections = strategy.get("requiredSections") or []
    required_artifacts = _normalize_artifacts(strategy.get("requiredArtifacts") or [])

    if not isinstance(raw, dict):
        raw = {}

    sections = raw.get("sections")
    if not isinstance(sections, list) or not sections:
        sections = [
            {
                "title": title,
                "goal": title,
                "artifacts": list(required_artifacts),
                "must_cover": [],
                "evidence": [],
            }
            for title in required_sections
        ]

    normalized_sections: list[AiDocumentPlanSection] = []
    for index, section in enumerate(sections, start=1):
        if not isinstance(section, dict):
            continue
        normalized_sections.append(
            {
                "id": section.get("id") or f"section-{index}",
                "title": str(section.get("title") or f"Section {index}"),
                "goal": str(section.get("goal") or section.get("title") or f"Section {index}"),
                "artifacts": _normalize_artifacts(section.get("artifacts") or []),
                "must_cover": list(dict.fromkeys(section.get("must_cover") or [])),
                "evidence": _normalize_evidence_sources(section.get("evidence") or []),
            }
        )

    return {
        "doc_type": str(raw.get("doc_type") or strategy.get("docType") or "general-document"),
        "audience": str(raw.get("audience") or strategy.get("audience") or ""),
        "required_artifacts": _normalize_artifacts(
            raw.get("required_artifacts") or required_artifacts
        ),
        "sections": normalized_sections,
    }
