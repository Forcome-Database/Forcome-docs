"""Tests for write_tools — write_single_section and write_all_sections."""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.draft import SectionDraft


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_section(sid: str = "s1", title: str = "Section") -> SectionPlan:
    return SectionPlan(id=sid, title=title, word_budget=300)


def _make_blueprint(sections: list[SectionPlan] | None = None) -> CreationBlueprint:
    return CreationBlueprint(
        title="Test Doc",
        sections=sections or [],
        total_word_budget=900,
    )


def _make_brief() -> CreationBrief:
    return CreationBrief(audience="engineers", style="technical")


def _make_draft(section_id: str = "s1", content: str = "Draft content.") -> SectionDraft:
    return SectionDraft(section_id=section_id, content=content, word_count=50)


def _make_async_write_section(drafts_to_return: list[SectionDraft]):
    """Return a coroutine factory that pops drafts in order."""
    call_count = [0]

    async def _fake_write_section(**kwargs) -> SectionDraft:
        idx = call_count[0]
        call_count[0] += 1
        if idx < len(drafts_to_return):
            return drafts_to_return[idx]
        return SectionDraft(section_id=kwargs.get("section", SectionPlan(id="unknown")).id)

    return _fake_write_section


# ---------------------------------------------------------------------------
# TestWriteSingleSection
# ---------------------------------------------------------------------------

class TestWriteSingleSection:
    @pytest.mark.asyncio
    async def test_calls_write_section_with_context(self):
        """write_single_section calls write_section with prev/next context."""
        from app.orchestrator.tools.write_tools import write_single_section

        s1 = _make_section("s1", "Intro")
        s2 = _make_section("s2", "Methods")
        blueprint = _make_blueprint([s1, s2])
        brief = _make_brief()

        expected_draft = _make_draft("s2", "Methods content")

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_ws, \
             patch("app.orchestrator.tools.write_tools.generate_section_visuals", new_callable=AsyncMock) as mock_gv:
            mock_ws.return_value = expected_draft
            mock_gv.return_value = []

            result = await write_single_section(
                section=s2,
                blueprint=blueprint,
                brief=brief,
                section_index=1,
                thread_id="t1",
            )

        assert result.section_id == "s2"
        mock_ws.assert_called_once()
        call_kwargs = mock_ws.call_args.kwargs
        assert call_kwargs["section"] == s2
        assert call_kwargs["blueprint"] == blueprint
        assert call_kwargs["section_index"] == 1
        assert call_kwargs["total_sections"] == 2

    @pytest.mark.asyncio
    async def test_passes_prev_tail_from_existing_drafts(self):
        """Previous draft's tail is passed as context to write_section."""
        from app.orchestrator.tools.write_tools import write_single_section

        s1 = _make_section("s1", "Intro")
        s2 = _make_section("s2", "Methods")
        blueprint = _make_blueprint([s1, s2])
        brief = _make_brief()

        prev_draft = _make_draft("s1", "First para.\n\nLast paragraph of intro.")
        expected_draft = _make_draft("s2")

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_ws, \
             patch("app.orchestrator.tools.write_tools.generate_section_visuals", new_callable=AsyncMock) as mock_gv:
            mock_ws.return_value = expected_draft
            mock_gv.return_value = []

            await write_single_section(
                section=s2,
                blueprint=blueprint,
                brief=brief,
                existing_drafts=[prev_draft],
                section_index=1,
                thread_id="t1",
            )

        call_kwargs = mock_ws.call_args.kwargs
        assert "Last paragraph of intro." in call_kwargs["prev_section_tail"]

    @pytest.mark.asyncio
    async def test_sets_visuals_generated_on_draft(self):
        """Generated visual URLs are stored in draft.visuals_generated."""
        from app.orchestrator.tools.write_tools import write_single_section

        s1 = _make_section("s1")
        blueprint = _make_blueprint([s1])
        brief = _make_brief()
        base_draft = _make_draft("s1")

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_ws, \
             patch("app.orchestrator.tools.write_tools.generate_section_visuals", new_callable=AsyncMock) as mock_gv:
            mock_ws.return_value = base_draft
            mock_gv.return_value = ["https://cdn.example.com/gen.png"]

            result = await write_single_section(
                section=s1,
                blueprint=blueprint,
                brief=brief,
                section_index=0,
                thread_id="t1",
                page_id="page-42",
            )

        assert result.visuals_generated == ["https://cdn.example.com/gen.png"]

    @pytest.mark.asyncio
    async def test_emits_section_progress_event(self):
        """section_progress SSE event is emitted with correct current/total."""
        from app.orchestrator.tools.write_tools import write_single_section

        s1 = _make_section("s1", "Intro")
        s2 = _make_section("s2", "Body")
        blueprint = _make_blueprint([s1, s2])
        brief = _make_brief()

        emitted_events = []

        async def fake_emit(thread_id, event):
            emitted_events.append(event)

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_ws, \
             patch("app.orchestrator.tools.write_tools.generate_section_visuals", new_callable=AsyncMock) as mock_gv, \
             patch("app.orchestrator.tools.write_tools.emit", side_effect=fake_emit):
            mock_ws.return_value = _make_draft("s2")
            mock_gv.return_value = []

            await write_single_section(
                section=s2,
                blueprint=blueprint,
                brief=brief,
                section_index=1,
                thread_id="t1",
            )

        progress_events = [e for e in emitted_events if e.get("type") == "section_progress"]
        assert len(progress_events) == 1
        assert progress_events[0]["current"] == 2
        assert progress_events[0]["total"] == 2
        assert progress_events[0]["section_title"] == "Body"


# ---------------------------------------------------------------------------
# TestWriteAllSectionsSequential
# ---------------------------------------------------------------------------

class TestWriteAllSectionsSequential:
    @pytest.mark.asyncio
    async def test_returns_correct_number_of_drafts(self):
        from app.orchestrator.tools.write_tools import write_all_sections

        sections = [_make_section(f"s{i}", f"Section {i}") for i in range(3)]
        blueprint = _make_blueprint(sections)
        brief = _make_brief()

        fake_drafts = [_make_draft(s.id) for s in sections]
        call_order = []

        async def fake_write_single(**kwargs):
            sid = kwargs["section"].id
            call_order.append(sid)
            return fake_drafts[int(sid[1:])]

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            result = await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=False,
            )

        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_sequential_order_preserved(self):
        """Sections are written in order s0 → s1 → s2."""
        from app.orchestrator.tools.write_tools import write_all_sections

        sections = [_make_section(f"s{i}", f"Section {i}") for i in range(3)]
        blueprint = _make_blueprint(sections)
        brief = _make_brief()

        call_order = []

        async def fake_write_single(**kwargs):
            sid = kwargs["section"].id
            call_order.append(sid)
            return _make_draft(sid)

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=False,
            )

        assert call_order == ["s0", "s1", "s2"]

    @pytest.mark.asyncio
    async def test_each_section_receives_previous_drafts(self):
        """Each sequential write_single_section call receives accumulated drafts."""
        from app.orchestrator.tools.write_tools import write_all_sections

        s0 = _make_section("s0", "Intro")
        s1 = _make_section("s1", "Body")
        s2 = _make_section("s2", "Conclusion")
        blueprint = _make_blueprint([s0, s1, s2])
        brief = _make_brief()

        received_draft_counts = []

        async def fake_write_single(**kwargs):
            sid = kwargs["section"].id
            existing = kwargs.get("existing_drafts") or []
            received_draft_counts.append(len(existing))
            return _make_draft(sid)

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=False,
            )

        # s0 gets 0 previous drafts, s1 gets 1, s2 gets 2
        assert received_draft_counts == [0, 1, 2]

    @pytest.mark.asyncio
    async def test_empty_blueprint_returns_empty_list(self):
        from app.orchestrator.tools.write_tools import write_all_sections

        blueprint = _make_blueprint([])
        brief = _make_brief()

        result = await write_all_sections(blueprint=blueprint, brief=brief)
        assert result == []


# ---------------------------------------------------------------------------
# TestWriteAllSectionsParallel
# ---------------------------------------------------------------------------

class TestWriteAllSectionsParallel:
    @pytest.mark.asyncio
    async def test_parallel_returns_correct_count(self):
        from app.orchestrator.tools.write_tools import write_all_sections

        sections = [_make_section(f"s{i}", f"Sec {i}") for i in range(4)]
        blueprint = _make_blueprint(sections)
        brief = _make_brief()

        async def fake_write_single(**kwargs):
            return _make_draft(kwargs["section"].id)

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            result = await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=True,
            )

        assert len(result) == 4

    @pytest.mark.asyncio
    async def test_parallel_even_odd_grouping(self):
        """Even-indexed sections are written before odd-indexed sections."""
        from app.orchestrator.tools.write_tools import write_all_sections

        sections = [_make_section(f"s{i}", f"Sec {i}") for i in range(4)]
        blueprint = _make_blueprint(sections)
        brief = _make_brief()

        call_batches = []
        current_batch = []
        lock = asyncio.Lock()

        async def fake_write_single(**kwargs):
            sid = kwargs["section"].id
            async with lock:
                current_batch.append(sid)
            # Small delay to allow concurrent detection
            await asyncio.sleep(0)
            return _make_draft(sid)

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            result = await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=True,
            )

        # All 4 sections should be in the result
        result_ids = {d.section_id for d in result}
        expected_ids = {"s0", "s1", "s2", "s3"}
        assert result_ids == expected_ids

    @pytest.mark.asyncio
    async def test_parallel_result_order_matches_blueprint(self):
        """Parallel results maintain the blueprint section order."""
        from app.orchestrator.tools.write_tools import write_all_sections

        sections = [_make_section(f"s{i}", f"Sec {i}") for i in range(5)]
        blueprint = _make_blueprint(sections)
        brief = _make_brief()

        async def fake_write_single(**kwargs):
            return _make_draft(kwargs["section"].id)

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            result = await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=True,
            )

        # Result should be in blueprint order
        assert [d.section_id for d in result] == ["s0", "s1", "s2", "s3", "s4"]

    @pytest.mark.asyncio
    async def test_parallel_single_section_blueprint(self):
        """Parallel mode with a single section works without error."""
        from app.orchestrator.tools.write_tools import write_all_sections

        sections = [_make_section("s0", "Only")]
        blueprint = _make_blueprint(sections)
        brief = _make_brief()

        async def fake_write_single(**kwargs):
            return _make_draft(kwargs["section"].id)

        with patch("app.orchestrator.tools.write_tools.write_single_section", side_effect=fake_write_single):
            result = await write_all_sections(
                blueprint=blueprint,
                brief=brief,
                parallel=True,
            )

        assert len(result) == 1
        assert result[0].section_id == "s0"
