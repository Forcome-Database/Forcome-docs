"""Tests for Fixer Worker — auto-fix functions + targeted LLM fixer."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.draft import SectionDraft
from app.models.review import ReviewIssue
from app.workers.fixer import (
    apply_auto_fixes,
    auto_fix_empty_mermaid,
    auto_fix_heading_levels,
    auto_fix_invalid_image_urls,
    auto_fix_placeholder_images,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def make_draft(section_id: str = "s1", content: str = "Content here.") -> SectionDraft:
    return SectionDraft(section_id=section_id, content=content)


def make_issue(
    issue_id: str = "i1",
    section_id: str | None = "s1",
    category: str = "format",
    description: str = "Test issue",
    auto_fixable: bool = True,
    fixed: bool = False,
) -> ReviewIssue:
    return ReviewIssue(
        id=issue_id,
        section_id=section_id,
        severity="warning",
        category=category,
        description=description,
        suggestion="Fix it",
        auto_fixable=auto_fixable,
        fixed=fixed,
    )


# ── auto_fix_heading_levels ───────────────────────────────────────────────────

def test_fix_heading_levels_h1_in_h2_section():
    content = "# Top Level Heading\n\nSome content."
    fixed = auto_fix_heading_levels(content, section_level=2)
    assert fixed == "### Top Level Heading\n\nSome content."


def test_fix_heading_levels_h2_in_h2_section():
    content = "## Same Level\n\nContent"
    fixed = auto_fix_heading_levels(content, section_level=2)
    assert fixed == "### Same Level\n\nContent"


def test_fix_heading_levels_deeper_unchanged():
    content = "### Sub heading\n\nContent"
    fixed = auto_fix_heading_levels(content, section_level=2)
    assert fixed == "### Sub heading\n\nContent"


def test_fix_heading_levels_mixed_content():
    content = "# Bad\n\nProse\n\n### Good\n\nMore"
    fixed = auto_fix_heading_levels(content, section_level=2)
    lines = fixed.split('\n')
    assert lines[0] == "### Bad"
    assert lines[4] == "### Good"  # unchanged


def test_fix_heading_levels_no_headings_unchanged():
    content = "Just plain prose."
    fixed = auto_fix_heading_levels(content, section_level=2)
    assert fixed == "Just plain prose."


def test_fix_heading_levels_h1_section_preserves_h2():
    """In an H1 section, H2+ headings are valid (deeper)."""
    content = "## Subsection\n\nContent"
    fixed = auto_fix_heading_levels(content, section_level=1)
    assert fixed == "## Subsection\n\nContent"


# ── auto_fix_empty_mermaid ────────────────────────────────────────────────────

def test_fix_empty_mermaid_removes_block():
    content = "Before\n```mermaid\n```\nAfter"
    fixed = auto_fix_empty_mermaid(content)
    assert "```mermaid" not in fixed
    assert "Before" in fixed
    assert "After" in fixed


def test_fix_empty_mermaid_with_whitespace():
    content = "Text\n```mermaid\n   \n```\nMore"
    fixed = auto_fix_empty_mermaid(content)
    assert "```mermaid" not in fixed


def test_fix_empty_mermaid_valid_block_unchanged():
    content = "```mermaid\ngraph TD\n  A --> B\n```"
    fixed = auto_fix_empty_mermaid(content)
    assert fixed == content


def test_fix_empty_mermaid_no_mermaid_unchanged():
    content = "Just regular content."
    fixed = auto_fix_empty_mermaid(content)
    assert fixed == content


# ── auto_fix_placeholder_images ───────────────────────────────────────────────

def test_fix_placeholder_placehold_co():
    content = "Text ![img](https://placehold.co/400x300) more text"
    fixed = auto_fix_placeholder_images(content)
    assert "placehold.co" not in fixed
    assert "Text" in fixed
    assert "more text" in fixed


def test_fix_placeholder_dummyimage():
    content = "![chart](https://dummyimage.com/600x400/000/fff)"
    fixed = auto_fix_placeholder_images(content)
    assert "dummyimage.com" not in fixed


def test_fix_placeholder_via_placeholder():
    content = "![x](https://via.placeholder.com/150)"
    fixed = auto_fix_placeholder_images(content)
    assert "via.placeholder" not in fixed


def test_fix_placeholder_real_image_unchanged():
    content = "![real](https://cdn.example.com/photo.jpg)"
    fixed = auto_fix_placeholder_images(content)
    assert fixed == content


def test_fix_placeholder_multiple_in_one_section():
    content = "![a](https://placehold.co/100) text ![b](https://dummyimage.com/200)"
    fixed = auto_fix_placeholder_images(content)
    assert "placehold.co" not in fixed
    assert "dummyimage.com" not in fixed


# ── auto_fix_invalid_image_urls ───────────────────────────────────────────────

def test_fix_invalid_relative_path():
    content = "![photo](./images/photo.png)"
    fixed = auto_fix_invalid_image_urls(content)
    assert "![photo]" not in fixed


def test_fix_invalid_no_scheme():
    content = "![img](images/test.jpg)"
    fixed = auto_fix_invalid_image_urls(content)
    assert "![img]" not in fixed


def test_fix_invalid_http_url_unchanged():
    content = "![img](http://example.com/img.jpg)"
    fixed = auto_fix_invalid_image_urls(content)
    assert fixed == content


def test_fix_invalid_https_url_unchanged():
    content = "![img](https://example.com/img.jpg)"
    fixed = auto_fix_invalid_image_urls(content)
    assert fixed == content


# ── apply_auto_fixes ──────────────────────────────────────────────────────────

def test_apply_auto_fixes_heading_issue():
    draft = make_draft("s1", content="# Bad Heading\n\nContent")
    issue = make_issue("i1", "s1", "format", "章节'Intro'中包含 H1 标题，但该章节本身是 H2", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft], [issue], section_levels={"s1": 2})
    assert count == 1
    assert issue.fixed is True
    assert "### Bad Heading" in drafts[0].content


def test_apply_auto_fixes_mermaid_issue():
    draft = make_draft("s1", content="Before\n```mermaid\n```\nAfter")
    issue = make_issue("i1", "s1", "format", "空的 Mermaid 代码块", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft], [issue])
    assert count == 1
    assert issue.fixed is True
    assert "```mermaid" not in drafts[0].content


def test_apply_auto_fixes_placeholder_issue():
    draft = make_draft("s1", content="![x](https://placehold.co/400x300)")
    issue = make_issue("i1", "s1", "visual", "占位符图片链接: ...", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft], [issue])
    assert count == 1
    assert issue.fixed is True
    assert "placehold.co" not in drafts[0].content


def test_apply_auto_fixes_invalid_url_issue():
    draft = make_draft("s1", content="![img](./local/path.png)")
    issue = make_issue("i1", "s1", "visual", "无效图片链接: ...", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft], [issue])
    assert count == 1
    assert issue.fixed is True


def test_apply_auto_fixes_skips_non_auto_fixable():
    draft = make_draft("s1", content="Short")
    issue = make_issue("i1", "s1", "structure", "Content too short", auto_fixable=False)
    drafts, count = apply_auto_fixes([draft], [issue])
    assert count == 0
    assert issue.fixed is False
    assert drafts[0].content == "Short"


def test_apply_auto_fixes_skips_already_fixed():
    draft = make_draft("s1", content="# H1\n\nContent")
    issue = make_issue("i1", "s1", "format", "章节'X'中包含 H1 标题，但该章节本身是 H2", auto_fixable=True, fixed=True)
    drafts, count = apply_auto_fixes([draft], [issue], section_levels={"s1": 2})
    assert count == 0
    assert "# H1" in drafts[0].content  # unchanged


def test_apply_auto_fixes_multiple_drafts():
    """Each draft gets its own issues applied."""
    draft1 = make_draft("s1", content="![x](https://placehold.co/100)")
    draft2 = make_draft("s2", content="![y](./local.png)")
    issue1 = make_issue("i1", "s1", "visual", "占位符图片链接: ...", auto_fixable=True)
    issue2 = make_issue("i2", "s2", "visual", "无效图片链接: ...", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft1, draft2], [issue1, issue2])
    assert count == 2
    assert "placehold.co" not in drafts[0].content
    assert "![y]" not in drafts[1].content


def test_apply_auto_fixes_section_id_none_applies_to_all():
    """Issue with section_id=None should apply to all drafts."""
    draft1 = make_draft("s1", content="![x](./rel.png)")
    draft2 = make_draft("s2", content="![y](./rel2.png)")
    issue = make_issue("i1", None, "visual", "无效图片链接: ...", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft1, draft2], [issue])
    # First draft matches, fixes it; issue is marked fixed and skipped for s2
    assert count >= 1


def test_apply_auto_fixes_default_section_level():
    """Falls back to level 2 when not in section_levels map."""
    draft = make_draft("s1", content="# H1\n\nContent")
    issue = make_issue("i1", "s1", "format", "章节'X'中包含 H1 标题，但该章节本身是 H2", auto_fixable=True)
    drafts, count = apply_auto_fixes([draft], [issue])  # no section_levels provided
    assert count == 1
    assert "### H1" in drafts[0].content


# ── fix_targeted ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fix_targeted_returns_llm_output():
    from app.workers.fixer import fix_targeted

    issue = make_issue("i1", "s1", "content", "Missing examples", auto_fixable=False)
    issue.suggestion = "Add concrete examples"

    mock_result = MagicMock()
    mock_result.data = "Fixed section content with examples added."

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", new_callable=AsyncMock):
        result = await fix_targeted("Original content.", issue, "thread-1")

    assert result == "Fixed section content with examples added."


@pytest.mark.asyncio
async def test_fix_targeted_prefers_output_text_over_wrapper_repr():
    from app.workers.fixer import fix_targeted

    issue = make_issue("i1", "s1", "content", "Remove wrapper text", auto_fixable=False)

    mock_result = MagicMock()
    mock_result.output = "Clean fixed section content."
    mock_result.data = {"unexpected": "structured"}
    mock_result.__str__.return_value = "AgentRunResult(output='wrapped text')"

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", new_callable=AsyncMock):
        result = await fix_targeted("Original content.", issue, "thread-1")

    assert result == "Clean fixed section content."


@pytest.mark.asyncio
async def test_fix_targeted_emits_events():
    from app.workers.fixer import fix_targeted

    issue = make_issue("i1", "s1", "content", "Missing examples", auto_fixable=False)

    mock_result = MagicMock()
    mock_result.data = "Fixed."

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    emit_calls = []

    async def fake_emit(tid, event):
        emit_calls.append(event)

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", side_effect=fake_emit):
        await fix_targeted("Content.", issue, "t1")

    types = [e["type"] for e in emit_calls]
    assert "step_start" in types
    assert "step_done" in types


@pytest.mark.asyncio
async def test_fix_targeted_large_change_emits_warning():
    """When fix changes >30% of content, an extra warning event is emitted."""
    from app.workers.fixer import fix_targeted

    issue = make_issue("i1", "s1", "content", "Rewrite needed", auto_fixable=False)

    original = "A" * 100
    # Return something 50% larger — triggers warning
    big_fix = "B" * 160

    mock_result = MagicMock()
    mock_result.data = big_fix

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    emit_calls = []

    async def fake_emit(tid, event):
        emit_calls.append(event)

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", side_effect=fake_emit):
        result = await fix_targeted(original, issue, "t1")

    assert result == big_fix
    # Warning event should contain "⚠️"
    warning_events = [e for e in emit_calls if "⚠️" in e.get("result_summary", "")]
    assert len(warning_events) >= 1
