"""Tests for fix_selected_issues orchestrator tool."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.draft import SectionDraft
from app.models.review import ReviewIssue


# ── helpers ──────────────────────────────────────────────────────────────────

def make_section(sid: str, level: int = 2) -> SectionPlan:
    return SectionPlan(id=sid, title=f"Section {sid}", level=level)


def make_blueprint(*sections: SectionPlan) -> CreationBlueprint:
    return CreationBlueprint(title="Test Doc", sections=list(sections))


def make_draft(section_id: str, content: str = "Original content here.") -> SectionDraft:
    return SectionDraft(section_id=section_id, content=content, word_count=3)


def make_issue(
    issue_id: str,
    section_id: str | None = "s1",
    auto_fixable: bool = False,
    fixed: bool = False,
    category: str = "content",
    description: str = "Test issue",
) -> ReviewIssue:
    return ReviewIssue(
        id=issue_id,
        section_id=section_id,
        severity="warning",
        category=category,
        description=description,
        suggestion="Fix suggestion",
        auto_fixable=auto_fixable,
        fixed=fixed,
    )


# ── fix_selected_issues ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fix_selected_auto_fix_applied():
    """Auto-fixable issues are fixed regardless of selected_issue_ids."""
    from app.orchestrator.tools.fix_tools import fix_selected_issues

    blueprint = make_blueprint(make_section("s1", level=2))
    draft = make_draft("s1", content="# Bad H1\n\nContent")
    auto_issue = make_issue("auto-1", "s1", auto_fixable=True, category="format", description="章节'X'中包含 H1 标题，但该章节本身是 H2")

    with patch("app.orchestrator.tools.fix_tools.emit", new_callable=AsyncMock):
        result = await fix_selected_issues(
            drafts=[draft],
            issues=[auto_issue],
            selected_issue_ids=[],  # none explicitly selected
            blueprint=blueprint,
            thread_id="t1",
        )

    assert auto_issue.fixed is True
    # H1 was demoted to H3 (section level 2 + 1)
    assert result[0].content.startswith("### Bad H1")


@pytest.mark.asyncio
async def test_fix_selected_targeted_fix_for_selected():
    """Selected non-auto issues get LLM fix applied."""
    from app.orchestrator.tools.fix_tools import fix_selected_issues

    blueprint = make_blueprint(make_section("s1"))
    draft = make_draft("s1", content="Missing examples section.")
    manual_issue = make_issue("manual-1", "s1", auto_fixable=False, category="content", description="Missing examples")

    fixed_content = "Section with examples added: 1, 2, 3."

    with patch("app.orchestrator.tools.fix_tools.apply_auto_fixes", return_value=([draft], 0)), \
         patch("app.orchestrator.tools.fix_tools.fix_targeted", new_callable=AsyncMock, return_value=fixed_content), \
         patch("app.orchestrator.tools.fix_tools.emit", new_callable=AsyncMock):
        result = await fix_selected_issues(
            drafts=[draft],
            issues=[manual_issue],
            selected_issue_ids=["manual-1"],
            blueprint=blueprint,
            thread_id="t1",
        )

    assert result[0].content == fixed_content
    assert manual_issue.fixed is True


@pytest.mark.asyncio
async def test_fix_selected_unselected_not_fixed():
    """Non-auto-fixable issues NOT in selected_issue_ids are left untouched."""
    from app.orchestrator.tools.fix_tools import fix_selected_issues

    blueprint = make_blueprint(make_section("s1"))
    draft = make_draft("s1")
    issue = make_issue("manual-1", "s1", auto_fixable=False)

    fix_targeted_mock = AsyncMock(return_value="Fixed content")

    with patch("app.orchestrator.tools.fix_tools.apply_auto_fixes", return_value=([draft], 0)), \
         patch("app.orchestrator.tools.fix_tools.fix_targeted", fix_targeted_mock), \
         patch("app.orchestrator.tools.fix_tools.emit", new_callable=AsyncMock):
        await fix_selected_issues(
            drafts=[draft],
            issues=[issue],
            selected_issue_ids=[],  # NOT selected
            blueprint=blueprint,
        )

    fix_targeted_mock.assert_not_called()
    assert issue.fixed is False


@pytest.mark.asyncio
async def test_fix_selected_skips_issue_with_no_section_id():
    """Issues with section_id=None are skipped for LLM fix."""
    from app.orchestrator.tools.fix_tools import fix_selected_issues

    blueprint = make_blueprint(make_section("s1"))
    draft = make_draft("s1")
    issue = make_issue("global-1", section_id=None, auto_fixable=False)

    fix_targeted_mock = AsyncMock(return_value="Fixed")

    with patch("app.orchestrator.tools.fix_tools.apply_auto_fixes", return_value=([draft], 0)), \
         patch("app.orchestrator.tools.fix_tools.fix_targeted", fix_targeted_mock), \
         patch("app.orchestrator.tools.fix_tools.emit", new_callable=AsyncMock):
        await fix_selected_issues(
            drafts=[draft],
            issues=[issue],
            selected_issue_ids=["global-1"],
            blueprint=blueprint,
        )

    fix_targeted_mock.assert_not_called()


@pytest.mark.asyncio
async def test_fix_selected_skips_section_not_found():
    """Selected issue with unknown section_id skips LLM fix gracefully."""
    from app.orchestrator.tools.fix_tools import fix_selected_issues

    blueprint = make_blueprint(make_section("s1"))
    draft = make_draft("s1")
    issue = make_issue("orphan-1", section_id="s999", auto_fixable=False)  # s999 doesn't exist

    fix_targeted_mock = AsyncMock(return_value="Fixed")

    with patch("app.orchestrator.tools.fix_tools.apply_auto_fixes", return_value=([draft], 0)), \
         patch("app.orchestrator.tools.fix_tools.fix_targeted", fix_targeted_mock), \
         patch("app.orchestrator.tools.fix_tools.emit", new_callable=AsyncMock):
        result = await fix_selected_issues(
            drafts=[draft],
            issues=[issue],
            selected_issue_ids=["orphan-1"],
            blueprint=blueprint,
        )

    fix_targeted_mock.assert_not_called()
    assert result[0].content == "Original content here."


@pytest.mark.asyncio
async def test_fix_selected_updates_word_count():
    """After LLM fix, word_count is recalculated."""
    from app.orchestrator.tools.fix_tools import fix_selected_issues

    blueprint = make_blueprint(make_section("s1"))
    draft = make_draft("s1", content="Short.")
    issue = make_issue("i1", "s1", auto_fixable=False)

    new_content = "This is a longer fixed section with many more words added."

    with patch("app.orchestrator.tools.fix_tools.apply_auto_fixes", return_value=([draft], 0)), \
         patch("app.orchestrator.tools.fix_tools.fix_targeted", new_callable=AsyncMock, return_value=new_content), \
         patch("app.orchestrator.tools.fix_tools.emit", new_callable=AsyncMock):
        result = await fix_selected_issues(
            drafts=[draft],
            issues=[issue],
            selected_issue_ids=["i1"],
            blueprint=blueprint,
        )

    assert result[0].word_count > 3  # more than original "Short." word count
