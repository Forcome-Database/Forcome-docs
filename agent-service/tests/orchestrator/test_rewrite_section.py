"""Tests for rewrite_section tool."""
from __future__ import annotations
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.draft import SectionDraft


def _make_blueprint() -> CreationBlueprint:
    return CreationBlueprint(
        title="Test Doc",
        sections=[
            SectionPlan(id="sec-1", title="Introduction", level=2, word_budget=300, description="Intro section"),
            SectionPlan(id="sec-2", title="Main Body", level=2, word_budget=500, description="Core content"),
            SectionPlan(id="sec-3", title="Conclusion", level=2, word_budget=200, description="Wrap up"),
        ],
    )


def _make_brief() -> CreationBrief:
    b = MagicMock(spec=CreationBrief)
    b.audience = "developers"
    b.style = "technical"
    return b


def _make_drafts() -> list[SectionDraft]:
    return [
        SectionDraft(section_id="sec-1", content="Intro content paragraph here.", word_count=5),
        SectionDraft(section_id="sec-2", content="Main body content.", word_count=3),
        SectionDraft(section_id="sec-3", content="Conclusion text.", word_count=2),
    ]


@pytest.mark.asyncio
async def test_rewrite_finds_section_by_id():
    blueprint = _make_blueprint()
    brief = _make_brief()
    drafts = _make_drafts()
    expected_draft = SectionDraft(section_id="sec-2", content="Rewritten content.", word_count=150, budget_compliance=0.3)

    with patch("app.orchestrator.tools.rewrite_section.write_section", new=AsyncMock(return_value=expected_draft)), \
         patch("app.orchestrator.tools.rewrite_section.emit", new=AsyncMock()):
        from app.orchestrator.tools.rewrite_section import rewrite_section
        result = await rewrite_section(
            section_id="sec-2",
            feedback="Make it more detailed",
            blueprint=blueprint,
            brief=brief,
            existing_drafts=drafts,
        )

    assert result.section_id == "sec-2"
    assert result.content == "Rewritten content."


@pytest.mark.asyncio
async def test_rewrite_raises_on_invalid_section_id():
    blueprint = _make_blueprint()
    brief = _make_brief()
    drafts = _make_drafts()

    with patch("app.orchestrator.tools.rewrite_section.emit", new=AsyncMock()):
        from app.orchestrator.tools.rewrite_section import rewrite_section
        with pytest.raises(ValueError, match="not found in blueprint"):
            await rewrite_section(
                section_id="nonexistent-id",
                feedback="Rewrite this",
                blueprint=blueprint,
                brief=brief,
                existing_drafts=drafts,
            )


@pytest.mark.asyncio
async def test_rewrite_injects_feedback_into_description():
    blueprint = _make_blueprint()
    brief = _make_brief()
    drafts = _make_drafts()
    expected_draft = SectionDraft(section_id="sec-1", content="New intro.", word_count=50, budget_compliance=0.17)

    captured_section = {}

    async def mock_write_section(*, section, **kwargs):
        captured_section["section"] = section
        return expected_draft

    with patch("app.orchestrator.tools.rewrite_section.write_section", new=mock_write_section), \
         patch("app.orchestrator.tools.rewrite_section.emit", new=AsyncMock()):
        from app.orchestrator.tools.rewrite_section import rewrite_section
        await rewrite_section(
            section_id="sec-1",
            feedback="Add more examples",
            blueprint=blueprint,
            brief=brief,
            existing_drafts=drafts,
        )

    modified = captured_section["section"]
    assert "Add more examples" in modified.description
    assert "[User feedback for rewrite]" in modified.description
    assert modified.id == "sec-1"
    assert modified.title == "Introduction"


@pytest.mark.asyncio
async def test_rewrite_preserves_section_metadata():
    blueprint = _make_blueprint()
    brief = _make_brief()
    drafts = _make_drafts()
    expected_draft = SectionDraft(section_id="sec-2", content="Rewritten.", word_count=200, budget_compliance=0.4)

    captured = {}

    async def mock_write_section(*, section, section_index, total_sections, **kwargs):
        captured["section_index"] = section_index
        captured["total_sections"] = total_sections
        captured["section"] = section
        return expected_draft

    with patch("app.orchestrator.tools.rewrite_section.write_section", new=mock_write_section), \
         patch("app.orchestrator.tools.rewrite_section.emit", new=AsyncMock()):
        from app.orchestrator.tools.rewrite_section import rewrite_section
        await rewrite_section(
            section_id="sec-2",
            feedback="More detail",
            blueprint=blueprint,
            brief=brief,
            existing_drafts=drafts,
        )

    assert captured["section_index"] == 1
    assert captured["total_sections"] == 3
    assert captured["section"].level == 2
    assert captured["section"].word_budget == 500


@pytest.mark.asyncio
async def test_rewrite_uses_single_pass_generation():
    blueprint = _make_blueprint()
    brief = _make_brief()
    drafts = _make_drafts()
    expected_draft = SectionDraft(section_id="sec-2", content="Rewritten.", word_count=200, budget_compliance=0.4)

    captured = {}

    async def mock_write_section(**kwargs):
        captured.update(kwargs)
        return expected_draft

    with patch("app.orchestrator.tools.rewrite_section.write_section", new=mock_write_section), \
         patch("app.orchestrator.tools.rewrite_section.emit", new=AsyncMock()):
        from app.orchestrator.tools.rewrite_section import rewrite_section
        await rewrite_section(
            section_id="sec-2",
            feedback="Tighten the language",
            blueprint=blueprint,
            brief=brief,
            existing_drafts=drafts,
        )

    assert captured["max_retries"] == 0


@pytest.mark.asyncio
async def test_rewrite_emits_step_events():
    blueprint = _make_blueprint()
    brief = _make_brief()
    drafts = _make_drafts()
    expected_draft = SectionDraft(section_id="sec-1", content="Done.", word_count=1, budget_compliance=0.003)

    emitted_events = []

    async def capture_emit(thread_id, event):
        emitted_events.append(event)

    with patch("app.orchestrator.tools.rewrite_section.write_section", new=AsyncMock(return_value=expected_draft)), \
         patch("app.orchestrator.tools.rewrite_section.emit", new=capture_emit):
        from app.orchestrator.tools.rewrite_section import rewrite_section
        await rewrite_section(
            section_id="sec-1",
            feedback="Revise",
            blueprint=blueprint,
            brief=brief,
            existing_drafts=drafts,
            thread_id="test-thread",
        )

    event_types = [e["type"] for e in emitted_events]
    assert "step_start" in event_types
    assert "step_done" in event_types
