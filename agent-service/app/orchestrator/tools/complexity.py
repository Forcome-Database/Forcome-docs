"""Task complexity analyzer — deterministic Level 1/2/3 classifier.

No LLM calls needed. Uses keyword matching and contextual rules to determine
the appropriate complexity level for a creation task.

Levels:
    1 — Simple edit (translate, fix, simplify, proofread). Direct execution.
    2 — Moderate edit (format, continue, expand). Light confirmation then execute.
    3 — Full creation (write, compose, design, generate). Brief → Blueprint → Write → Review.
"""
from __future__ import annotations

import re
from typing import Any, TypedDict


class ComplexityResult(TypedDict):
    level: int
    reasoning: str


# Level 1: Simple editing/transformation keywords
_L1_KW = {
    "translate", "fix spelling", "fix grammar", "shorten", "shorter",
    "make shorter", "make longer", "longer", "simplify", "change tone",
    "proofread", "correct",
    # Chinese equivalents
    "翻译", "改错", "纠错", "精简", "缩短", "简化", "改语气", "校对", "润色", "改正",
}

# Level 2: Moderate editing/continuation keywords
# NOTE: longer multi-character Chinese keywords (e.g. "续写") must be listed
# before single-char L3 keywords (e.g. "写") so they are matched first.
_L2_KW = {
    "format", "layout", "continue", "expand", "restructure", "elaborate",
    # Chinese equivalents
    "排版", "续写", "扩展", "扩充", "重构", "补充",
}

# Level 3: Full creation keywords
# Single-character Chinese keywords like "写" can be substrings of L2 words
# like "续写". The _matches_l3 helper excludes strings that are already
# matched by an L2 keyword to avoid false positives.
_L3_KW = {
    "create", "write", "rewrite", "compose", "design", "draft", "generate",
    # Chinese equivalents (multi-char entries take precedence over single-char)
    "创作", "仿写", "合并", "设计", "撰写", "起草", "生成", "编写",
    # "写" is kept but handled via _matches_l3 to avoid shadowing "续写"
    "写",
}


def _matches(msg: str, keywords: set[str]) -> bool:
    """Check if any keyword appears in the message (case-insensitive)."""
    lower = msg.lower()
    return any(kw.lower() in lower for kw in keywords)


def _matches_l3(msg: str) -> bool:
    """Check L3 keywords, but skip single-char Chinese matches that are part of
    a longer L2 keyword (e.g. '写' inside '续写' should not trigger L3)."""
    lower = msg.lower()
    for kw in _L3_KW:
        if kw.lower() not in lower:
            continue
        # If this is a single CJK character, make sure it isn't part of an L2 match
        if len(kw) == 1 and '\u4e00' <= kw <= '\u9fff':
            if _matches(msg, _L2_KW):
                continue
        return True
    return False


def analyze_task_complexity(
    *,
    user_message: str,
    files: list[dict[str, Any]],
    intent_route: str,
    template_id: str | None,
    selected_text: str | None,
) -> ComplexityResult:
    """Classify a creation task into complexity Level 1, 2, or 3.

    Rules (evaluated in priority order):
        1. selection_edit intent → Level 1 (always a targeted edit)
        2. L1 keywords (no files, no L3 override) → Level 1
        3. Multiple files (≥2) → Level 3
        4. Template + document_create intent → Level 3
        5. L3 keywords → Level 3
        6. Single file → Level 2
        7. L2 keywords → Level 2
        8. Default → Level 3

    Args:
        user_message: The user's natural language request.
        files: List of uploaded file metadata dicts.
        intent_route: Routing intent from the frontend (e.g. "selection_edit",
            "document_create", "document_transform").
        template_id: ID of any selected template, or None.
        selected_text: Any text selected in the editor, or None.

    Returns:
        ComplexityResult with ``level`` (int) and ``reasoning`` (str).
    """
    # Rule 1: selection_edit is always a targeted, simple edit
    if intent_route == "selection_edit":
        return ComplexityResult(level=1, reasoning="intent_route is selection_edit")

    # Rule 2: L1 keywords with no files (and no L3 keywords that override)
    if not files and _matches(user_message, _L1_KW) and not _matches_l3(user_message):
        return ComplexityResult(level=1, reasoning="Level 1 keyword detected")

    # Rule 3: Multiple files indicate a complex task (synthesis/analysis)
    if len(files) >= 2:
        return ComplexityResult(
            level=3, reasoning=f"multiple files ({len(files)})"
        )

    # Rule 4: Template + creation intent → structured full flow
    if template_id and intent_route == "document_create":
        return ComplexityResult(
            level=3, reasoning="template with creation intent"
        )

    # Rule 5: L3 keywords indicate full creation
    if _matches_l3(user_message):
        return ComplexityResult(level=3, reasoning="Level 3 keyword detected")

    # Rule 6: Single file without strong creation keywords → moderate
    if len(files) == 1:
        return ComplexityResult(level=2, reasoning="single file uploaded")

    # Rule 7: L2 keywords
    if _matches(user_message, _L2_KW):
        return ComplexityResult(level=2, reasoning="Level 2 keyword detected")

    # Default: assume full creation
    return ComplexityResult(level=3, reasoning="defaulting to full creation")
