"""Deterministic visual planning for document sections."""
from __future__ import annotations

import re

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import SectionPlan, SourceImageCandidate, VisualPlan
from app.models.brief import CreationBrief

_MERMAID_KEYWORDS = (
    "workflow",
    "sequence",
    "architecture",
    "pipeline",
    "flowchart",
    "flow",
    "process",
    "step",
    "stages",
    "phases",
    "lifecycle",
    "deployment",
    "topology",
    "dependency",
    "state machine",
    "diagram",
    "流程",
    "步骤",
    "架构",
    "时序",
    "部署",
)

_TABLE_KEYWORDS = (
    "compare",
    "comparison",
    "list",
    "parameters",
    "configuration",
    "properties",
    "specifications",
    "specs",
    "table",
    "matrix",
    "attributes",
    "metrics",
    "performance",
    "summary",
    "breakdown",
    "differences",
    "vs",
    "versus",
    "对比",
    "比较",
    "参数",
    "配置",
    "指标",
    "规格",
)

_STOP_WORDS = {
    "the",
    "and",
    "for",
    "this",
    "that",
    "with",
    "from",
    "are",
    "was",
    "has",
    "have",
    "its",
    "into",
    "but",
    "not",
    "more",
    "can",
    "will",
    "may",
    "been",
    "each",
    "also",
    "than",
    "how",
    "about",
    "some",
    "all",
    "any",
    "both",
    "your",
    "our",
    "their",
}


def _needs_mermaid(text: str) -> bool:
    return any(keyword in text.lower() for keyword in _MERMAID_KEYWORDS)


def _needs_table(text: str) -> bool:
    return any(keyword in text.lower() for keyword in _TABLE_KEYWORDS)


def _is_cjk(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x4E00 <= cp <= 0x9FFF
        or 0x3400 <= cp <= 0x4DBF
        or 0x20000 <= cp <= 0x2A6DF
        or 0xF900 <= cp <= 0xFAFF
    )


def _keywords(text: str) -> set[str]:
    tokens: set[str] = set()
    for word in re.findall(r"[A-Za-z0-9_-]+", text.lower()):
        if len(word) >= 3 and word not in _STOP_WORDS and not word.isdigit():
            tokens.add(word)

    for index, ch in enumerate(text):
        if not _is_cjk(ch):
            continue
        tokens.add(ch)
        if index + 1 < len(text) and _is_cjk(text[index + 1]):
            tokens.add(text[index:index + 2])

    return tokens


def _score_image_candidate(text: str, image: AssetItem) -> tuple[float, str]:
    section_keywords = _keywords(text)
    if not section_keywords:
        return 0.0, "no meaningful section keywords"

    caption_text = " ".join(
        part
        for part in (
            image.caption,
            image.summary,
            image.source_heading,
            image.content,
        )
        if part
    )
    image_keywords = _keywords(caption_text)
    if not image_keywords:
        return 0.0, "image lacks searchable metadata"

    overlap = section_keywords & image_keywords
    if not overlap:
        return 0.0, "no keyword overlap"

    score = float(len(overlap))
    if image.caption:
        score += 0.5
    if image.source_heading:
        heading_keywords = _keywords(image.source_heading)
        score += 0.5 * len(section_keywords & heading_keywords)

    rationale = f"overlap: {', '.join(sorted(overlap)[:6])}"
    return score, rationale


def _rank_image_candidates(text: str, images: list[AssetItem]) -> list[SourceImageCandidate]:
    candidates: list[SourceImageCandidate] = []
    for image in images:
        score, rationale = _score_image_candidate(text, image)
        if score <= 0:
            continue
        candidates.append(
            SourceImageCandidate(
                asset_id=image.id,
                score=score,
                caption=image.caption or image.summary,
                source=image.source,
                source_page=image.source_page,
                source_heading=image.source_heading,
                rationale=rationale,
            )
        )

    candidates.sort(key=lambda candidate: (-candidate.score, candidate.asset_id))
    return candidates


def _find_matching_image(text: str, images: list[AssetItem]) -> AssetItem | None:
    if not images or not text:
        return None

    candidates = _rank_image_candidates(text, images)
    if not candidates:
        return None

    top_candidate = candidates[0]
    return next((image for image in images if image.id == top_candidate.asset_id), None)


def plan_visuals(
    sections: list[SectionPlan],
    asset_map: AssetMap | None,
    brief: CreationBrief,
) -> list[SectionPlan]:
    if brief.image_strategy == "none":
        return [section.model_copy(update={"visual_candidates": []}) for section in sections]

    images = asset_map.items_by_type("image") if asset_map else []
    updated: list[SectionPlan] = []

    for section in sections:
        analysis_text = " ".join([section.description] + section.must_cover)
        visuals = list(section.visuals)
        visual_candidates = _rank_image_candidates(analysis_text, images) if images else []

        suggested: VisualPlan | None = None
        if visual_candidates and brief.image_strategy in {
            "reuse_source_only",
            "prefer_source_then_generate",
        }:
            top_candidate = visual_candidates[0]
            suggested = VisualPlan(
                type="reuse_image",
                description=f"Reuse source image: {top_candidate.caption[:100]}",
                source_asset_id=top_candidate.asset_id,
                position="end_of_section",
            )
        elif _needs_mermaid(analysis_text):
            suggested = VisualPlan(
                type="mermaid",
                description="Process or workflow diagram",
                position="end_of_section",
            )
        elif _needs_table(analysis_text):
            suggested = VisualPlan(
                type="table",
                description="Comparison or parameter table",
                position="end_of_section",
            )

        if suggested is not None:
            visuals.append(suggested)

        updated.append(
            section.model_copy(
                update={
                    "visuals": visuals,
                    "visual_candidates": visual_candidates,
                }
            )
        )

    return updated
