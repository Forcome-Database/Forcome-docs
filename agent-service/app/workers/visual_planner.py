"""VisualPlanner Worker — deterministic visual suggestion for document sections.

Analyzes section descriptions and must_cover points to suggest appropriate
visual elements (mermaid diagrams, tables, or reusing existing images from
the asset map). No LLM calls — pure keyword-based heuristics.
"""
from __future__ import annotations

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import SectionPlan, VisualPlan
from app.models.brief import CreationBrief


# ---------------------------------------------------------------------------
# Keyword detection helpers
# ---------------------------------------------------------------------------

# Keywords that suggest a process/workflow diagram
_MERMAID_KEYWORDS = (
    # Chinese
    "流程", "步骤", "架构", "序列", "工作流", "流水线", "管道",
    "时序", "状态机", "部署", "拓扑", "依赖", "调用链",
    # English
    "workflow", "sequence", "architecture", "pipeline", "flowchart",
    "flow", "process", "step", "stages", "phases", "lifecycle",
    "deployment", "topology", "dependency", "state machine", "diagram",
)

# Keywords that suggest a comparison table
_TABLE_KEYWORDS = (
    # Chinese
    "对比", "比较", "列表", "参数", "配置", "属性", "规格",
    "清单", "汇总", "统计", "指标", "性能", "差异",
    # English
    "compare", "comparison", "list", "parameters", "configuration",
    "properties", "specifications", "specs", "table", "matrix",
    "attributes", "metrics", "performance", "summary", "breakdown",
    "differences", "vs", "versus",
)


def _needs_mermaid(text: str) -> bool:
    """Return True if the text suggests a mermaid diagram is appropriate.

    Checks for process/workflow/architecture keywords.

    Args:
        text: Section description or must_cover points joined as a string.

    Returns:
        True if mermaid is suggested.
    """
    text_lower = text.lower()
    return any(kw in text_lower for kw in _MERMAID_KEYWORDS)


def _needs_table(text: str) -> bool:
    """Return True if the text suggests a table is appropriate.

    Checks for comparison/list/parameter keywords.

    Args:
        text: Section description or must_cover points joined as a string.

    Returns:
        True if a table is suggested.
    """
    text_lower = text.lower()
    return any(kw in text_lower for kw in _TABLE_KEYWORDS)


def _find_matching_image(text: str, images: list[AssetItem]) -> AssetItem | None:
    """Find the best matching image asset by keyword overlap.

    Uses simple keyword overlap between the section description/must_cover
    and image summaries. Returns the first image with ≥1 overlapping word
    (3+ characters) that is not a common stop word.

    Args:
        text: Section description + must_cover joined as a string.
        images: List of image AssetItems from the asset map.

    Returns:
        The best matching AssetItem, or None if no match found.
    """
    if not images or not text:
        return None

    # Extract meaningful tokens (≥2 chars for CJK, ≥3 chars for ASCII)
    _STOP_WORDS = {
        "the", "and", "for", "this", "that", "with", "from", "are",
        "was", "has", "have", "its", "into", "but", "not", "more",
        "can", "will", "may", "been", "each", "also", "than", "how",
        "about", "some", "all", "any", "both", "your", "our", "their",
    }

    def _is_cjk(ch: str) -> bool:
        """Return True if character is a CJK (Chinese/Japanese/Korean) character."""
        cp = ord(ch)
        return (
            0x4E00 <= cp <= 0x9FFF  # CJK Unified Ideographs
            or 0x3400 <= cp <= 0x4DBF  # Extension A
            or 0x20000 <= cp <= 0x2A6DF  # Extension B
            or 0xF900 <= cp <= 0xFAFF  # CJK Compatibility Ideographs
        )

    def _keywords(s: str) -> set[str]:
        tokens: set[str] = set()
        # ASCII word tokens
        for w in s.lower().split():
            clean = w.strip(".,;:()[]{}'\"-")
            if len(clean) >= 3 and not clean.isdigit() and clean not in _STOP_WORDS:
                tokens.add(clean)
        # CJK bigrams and trigrams for substring matching
        for i in range(len(s)):
            if _is_cjk(s[i]):
                # Add bigrams
                if i + 1 < len(s) and _is_cjk(s[i + 1]):
                    tokens.add(s[i:i + 2])
                # Add individual characters for 1-char matching
                tokens.add(s[i])
        return tokens

    section_kws = _keywords(text)
    if not section_kws:
        return None

    best_match: AssetItem | None = None
    best_score = 0

    for img in images:
        img_kws = _keywords(img.summary + " " + img.content)
        overlap = len(section_kws & img_kws)
        if overlap > best_score:
            best_score = overlap
            best_match = img

    return best_match if best_score > 0 else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def plan_visuals(
    sections: list[SectionPlan],
    asset_map: AssetMap | None,
    brief: CreationBrief,
) -> list[SectionPlan]:
    """Assign visual suggestions to sections deterministically (no LLM).

    For each section:
    - If image_strategy == "none", skip all visual suggestions.
    - Check if description + must_cover mention a process/workflow → mermaid.
    - Check if they mention comparison/list/parameters → table.
    - Check if an image in asset_map matches by keyword overlap → reuse_image.

    At most one visual per section is suggested (priority: reuse_image >
    mermaid > table, unless image_strategy == "none").

    Args:
        sections: List of SectionPlan objects to annotate.
        asset_map: Optional AssetMap containing available image assets.
        brief: The Smart Brief (used for image_strategy check).

    Returns:
        Updated list of SectionPlan with visuals populated where appropriate.
    """
    if brief.image_strategy == "none":
        # No visual suggestions when image strategy is "none"
        return sections

    images: list[AssetItem] = []
    if asset_map:
        images = asset_map.items_by_type("image")

    updated: list[SectionPlan] = []
    for section in sections:
        # Combine description and must_cover for analysis
        analysis_text = " ".join([section.description] + section.must_cover)

        visuals: list[VisualPlan] = list(section.visuals)  # preserve existing

        # Only suggest one new visual per section
        suggested: VisualPlan | None = None

        # Priority 1: reuse an existing image if there's a keyword match
        if images:
            matched_img = _find_matching_image(analysis_text, images)
            if matched_img:
                suggested = VisualPlan(
                    type="reuse_image",
                    description=f"Reuse image: {matched_img.summary[:100]}",
                    source_asset_id=matched_img.id,
                    position="end_of_section",
                )

        # Priority 2: mermaid for process/architecture descriptions
        if suggested is None and _needs_mermaid(analysis_text):
            suggested = VisualPlan(
                type="mermaid",
                description="Process or workflow diagram",
                position="end_of_section",
            )

        # Priority 3: table for comparison/list descriptions
        if suggested is None and _needs_table(analysis_text):
            suggested = VisualPlan(
                type="table",
                description="Comparison or parameter table",
                position="end_of_section",
            )

        if suggested is not None:
            visuals.append(suggested)

        updated.append(SectionPlan(
            id=section.id,
            title=section.title,
            level=section.level,
            word_budget=section.word_budget,
            description=section.description,
            assets=section.assets,
            visuals=visuals,
            must_cover=section.must_cover,
        ))

    return updated
