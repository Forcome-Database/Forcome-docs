from __future__ import annotations

import re
from typing import Any


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


def evaluate_document_quality(
    draft: str,
    strategy: dict[str, Any] | None = None,
    document_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    strategy = strategy or {}
    document_plan = document_plan or {}

    used_artifacts = detect_artifacts(draft)
    headings = extract_headings(draft)
    normalized_headings = [_normalize_label(item) for item in headings]

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

    issues = []
    if missing_artifacts:
        issues.append(
            "Missing required artifacts: " + ", ".join(missing_artifacts)
        )
    if missing_sections:
        issues.append(
            "Missing required sections/headings: " + ", ".join(missing_sections)
        )
    if len(draft) > 1200 and not headings:
        issues.append("Draft is long prose without clear markdown section headings")
    if required_artifacts and len(used_artifacts) == 0:
        issues.append("Draft does not use any structured artifacts despite requirements")

    return {
        "used_artifacts": used_artifacts,
        "missing_artifacts": missing_artifacts,
        "missing_sections": missing_sections,
        "issues": issues,
        "needs_rewrite": bool(issues),
    }
