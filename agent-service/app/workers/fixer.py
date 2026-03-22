"""Fixer Worker — applies targeted fixes to document sections.

Two modes:
1. Auto-fix: deterministic code fixes for format issues (no LLM)
2. Targeted fix: LLM-based fix for specific issues in specific sections
"""
from __future__ import annotations
import re
from app.models.draft import SectionDraft
from app.models.review import ReviewIssue
from app.orchestrator.llm_result import extract_text_output
from app.utils.markdown_images import is_supported_image_url
from app.utils.text import count_words


# ── deterministic auto-fixers ─────────────────────────────────────────────────

def auto_fix_heading_levels(
    content: str,
    section_level: int,
    section_title: str | None = None,
) -> str:
    """Fix heading levels that are same or higher than section level."""
    normalized = content.strip()
    normalized_title = (section_title or "").strip().casefold()
    if normalized and normalized_title:
        match = re.match(r'^(#{1,6})\s+(.+?)(?:\n+|$)', normalized)
        if match and match.group(2).strip().casefold() == normalized_title:
            return normalized[match.end():].lstrip()

    lines = content.split('\n')
    fixed = []
    for line in lines:
        match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if match:
            h_level = len(match.group(1))
            if h_level <= section_level:
                fixed.append(f"{'#' * (section_level + 1)} {match.group(2)}")
            else:
                fixed.append(line)
        else:
            fixed.append(line)
    return '\n'.join(fixed)


def auto_fix_empty_mermaid(content: str) -> str:
    """Remove empty Mermaid code blocks."""
    return re.sub(r'```mermaid\s*```', '', content)


def auto_fix_placeholder_images(content: str) -> str:
    """Remove placeholder image URLs."""
    patterns = [
        r'!\[[^\]]*\]\([^)]*placehold\.co[^)]*\)',
        r'!\[[^\]]*\]\([^)]*placeholder\.com[^)]*\)',
        r'!\[[^\]]*\]\([^)]*dummyimage\.com[^)]*\)',
        r'!\[[^\]]*\]\([^)]*via\.placeholder[^)]*\)',
        r'!\[[^\]]*\]\([^)]*example\.com/img[^)]*\)',
    ]
    result = content
    for pattern in patterns:
        result = re.sub(pattern, '', result)
    return result


def auto_fix_invalid_image_urls(content: str) -> str:
    """Remove images with unsupported URLs while preserving Docmost-managed assets."""

    def replace(match: re.Match[str]) -> str:
        alt_text, url = match.group(1), match.group(2)
        if is_supported_image_url(url):
            return match.group(0)
        return ""

    return re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', replace, content)


def apply_auto_fixes(
    drafts: list[SectionDraft],
    issues: list[ReviewIssue],
    section_levels: dict[str, int] | None = None,
    section_titles: dict[str, str] | None = None,
) -> tuple[list[SectionDraft], int]:
    """Apply all auto-fixable issues. Returns (fixed_drafts, fix_count)."""
    fix_count = 0
    section_levels = section_levels or {}
    section_titles = section_titles or {}

    for draft in drafts:
        original = draft.content
        content = draft.content

        # Collect auto-fixable issues for this section
        section_issues = [
            i for i in issues
            if i.auto_fixable and not i.fixed
            and (i.section_id == draft.section_id or i.section_id is None)
        ]

        for issue in section_issues:
            if issue.category == "format" and "标题" in issue.description:
                level = section_levels.get(draft.section_id, 2)
                content = auto_fix_heading_levels(
                    content,
                    level,
                    section_titles.get(draft.section_id or "", ""),
                )
            elif issue.category == "format" and "Mermaid" in issue.description:
                content = auto_fix_empty_mermaid(content)
            elif issue.category == "visual" and "占位符" in issue.description:
                content = auto_fix_placeholder_images(content)
            elif issue.category == "visual" and "无效" in issue.description:
                content = auto_fix_invalid_image_urls(content)

            if content != original:
                issue.fixed = True
                fix_count += 1
                original = content  # update baseline for next issue

        draft.content = content
        draft.word_count = count_words(content)

    return drafts, fix_count


# ── targeted LLM fixer ────────────────────────────────────────────────────────

TARGETED_FIX_PROMPT = """You are a precise document editor. You fix ONE specific issue at a time.

Rules:
1. Fix ONLY the described issue
2. Do NOT change any other content
3. Do NOT add explanations or commentary
4. Preserve all formatting, links, images, and structure
5. Output the complete fixed section content"""


async def fix_targeted(
    section_content: str,
    issue: ReviewIssue,
    thread_id: str = "",
    feedback: str | None = None,
) -> str:
    """Fix a specific issue in a section using LLM.

    The LLM is instructed to fix ONLY the described issue and leave everything else unchanged.
    """
    from pydantic_ai import Agent
    from app.orchestrator.llm_factory import create_pydantic_ai_model
    from app.agent.events import emit

    model = create_pydantic_ai_model()
    agent = Agent(model, system_prompt=TARGETED_FIX_PROMPT)

    prompt = f"""Fix ONLY the following issue in this section. Do NOT change anything else.

Issue: {issue.description}
Suggestion: {issue.suggestion}
User feedback: {feedback or "(none)"}

Section content:
{section_content}

Output the fixed section content only, no explanations."""

    await emit(thread_id, {
        "type": "step_start",
        "step": f"fix_{issue.id}",
        "description": f"修复: {issue.description[:50]}",
    })

    result = await agent.run(prompt)
    fixed = extract_text_output(result)

    # Warn if fix changed too much (>30% = suspicious)
    original_len = len(section_content)
    if original_len > 0:
        change_ratio = abs(len(fixed) - original_len) / original_len
        if change_ratio > 0.3:
            await emit(thread_id, {
                "type": "step_done",
                "step": f"fix_{issue.id}",
                "result_summary": f"⚠️ Fix changed {change_ratio:.0%} of content",
            })

    await emit(thread_id, {
        "type": "step_done",
        "step": f"fix_{issue.id}",
        "result_summary": "Fixed",
    })

    return fixed
