from __future__ import annotations

import re
from typing import Any

from app.agent.document_strategy import normalize_document_plan
from app.schemas.document_contracts import AiDocumentPlan, AiDocumentStrategy


def detect_artifacts(content: str) -> list[str]:
    artifacts = []
    if "```mermaid" in content:
        artifacts.append("mermaid")
    if re.search(r"^\|.+\|$", content, flags=re.MULTILINE):
        artifacts.append("table")
    if re.search(r"```[a-zA-Z0-9_-]+\n", content):
        artifacts.append("code_block")
    if any(
        token in content
        for token in (":::warning", ":::info", ":::danger", ":::success")
    ):
        artifacts.append("callout")
    if ":::details" in content:
        artifacts.append("details")
    if re.search(r"!\[[^\]]*\]\((https?://|/api/)", content):
        artifacts.append("image")
    return artifacts


def extract_headings(content: str) -> list[str]:
    return [
        match.group(2).strip().lower()
        for match in re.finditer(r"^(#{1,6})\s+(.+?)\s*$", content, flags=re.MULTILINE)
    ]


def _normalize_label(value: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", value.lower()).strip()


def _collect_required_coverage(
    strategy: AiDocumentStrategy | dict[str, Any],
    document_plan: AiDocumentPlan,
) -> list[str]:
    coverage = list(strategy.get("objectives") or [])
    for section in document_plan.get("sections") or []:
        if not isinstance(section, dict):
            continue
        coverage.extend(section.get("must_cover") or [])
    return list(dict.fromkeys(str(item) for item in coverage if str(item).strip()))


def _has_list_structure(content: str) -> bool:
    return bool(re.search(r"^(?:\s*[-*]\s+|\s*\d+\.\s+)", content, flags=re.MULTILINE))


def _has_unresolved_artifact_placeholders(content: str) -> bool:
    return bool(re.search(r"\[Artifact:\s*[^\]]+\]", content))


def evaluate_document_quality(
    draft: str,
    strategy: AiDocumentStrategy | dict[str, Any] | None = None,
    document_plan: AiDocumentPlan | dict[str, Any] | None = None,
) -> dict[str, Any]:
    strategy = strategy or {}
    document_plan = normalize_document_plan(document_plan or {}, strategy)

    used_artifacts = detect_artifacts(draft)
    headings = extract_headings(draft)
    normalized_headings = [_normalize_label(item) for item in headings]
    normalized_draft = _normalize_label(draft)

    required_artifacts = list(strategy.get("requiredArtifacts") or [])
    required_artifacts.extend(document_plan.get("required_artifacts") or [])
    required_artifacts = list(dict.fromkeys(required_artifacts))

    missing_artifacts = [
      artifact for artifact in required_artifacts if artifact not in used_artifacts
    ]

    required_sections = list(strategy.get("requiredSections") or [])
    for section in document_plan.get("sections") or []:
        if isinstance(section, dict) and section.get("title"):
            required_sections.append(str(section["title"]))
    required_sections = list(dict.fromkeys(required_sections))

    missing_sections = []
    for section in required_sections:
        normalized_section = _normalize_label(section)
        if not normalized_section:
            continue
        if not any(normalized_section in heading for heading in normalized_headings):
            missing_sections.append(section)

    required_coverage = _collect_required_coverage(strategy, document_plan)
    missing_coverage = []
    for item in required_coverage:
        normalized_item = _normalize_label(item)
        if not normalized_item:
            continue
        if normalized_item not in normalized_draft:
            missing_coverage.append(item)

    issues = []
    if missing_artifacts:
        issues.append(
            "Missing required artifacts: " + ", ".join(missing_artifacts)
        )
    if missing_sections:
        issues.append(
            "Missing required sections/headings: " + ", ".join(missing_sections)
        )
    if missing_coverage:
        issues.append(
            "Missing required coverage points: " + ", ".join(missing_coverage)
        )
    if _has_unresolved_artifact_placeholders(draft):
        issues.append("Draft still contains unresolved artifact placeholders")
    if len(draft) > 1200 and not headings:
        issues.append("Draft is long prose without clear markdown section headings")
    if required_artifacts and len(used_artifacts) == 0:
        issues.append("Draft does not use any structured artifacts despite requirements")
    if (
        len(draft) > 700
        and len(used_artifacts) == 0
        and not _has_list_structure(draft)
        and len(missing_coverage) > 0
    ):
        issues.append(
            "Draft is generic prose without enough structured support for the required points"
        )

    return {
        "used_artifacts": used_artifacts,
        "missing_artifacts": missing_artifacts,
        "missing_sections": missing_sections,
        "missing_coverage": missing_coverage,
        "issues": issues,
        "needs_rewrite": bool(issues),
    }
