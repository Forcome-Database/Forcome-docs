"""Tests for SectionWriter Worker — pure function build_section_context."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan, VisualPlan
from app.models.brief import CreationBrief
from app.models.draft import SectionDraft
from app.workers.section_writer import (
    build_section_context,
    get_next_section_header,
    get_prev_section_tail,
    write_section,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_section(
    sid: str = "s1",
    title: str = "Section One",
    level: int = 2,
    description: str = "Section description",
    must_cover: list[str] | None = None,
    assets: list[str] | None = None,
    visuals: list[VisualPlan] | None = None,
    word_budget: int = 300,
) -> SectionPlan:
    return SectionPlan(
        id=sid,
        title=title,
        level=level,
        description=description,
        must_cover=must_cover or [],
        assets=assets or [],
        visuals=visuals or [],
        word_budget=word_budget,
    )


def _make_blueprint(
    title: str = "Test Document",
    sections: list[SectionPlan] | None = None,
    total_word_budget: int = 1000,
) -> CreationBlueprint:
    return CreationBlueprint(
        title=title,
        sections=sections or [],
        total_word_budget=total_word_budget,
    )


def _make_brief(
    audience: str = "developers",
    style: str = "technical",
    goal: str = "explain system",
) -> CreationBrief:
    return CreationBrief(audience=audience, style=style, goal=goal)


def _make_asset_map(items: list[AssetItem] | None = None) -> AssetMap:
    return AssetMap(items=items or [])


def _make_asset(
    aid: str = "a1",
    atype: str = "text",
    content: str = "Asset content here",
    summary: str = "Asset summary",
) -> AssetItem:
    return AssetItem(id=aid, type=atype, content=content, summary=summary)  # type: ignore[arg-type]


def _make_draft(
    section_id: str = "s1",
    content: str = "Draft content here",
    word_count: int = 100,
) -> SectionDraft:
    return SectionDraft(section_id=section_id, content=content, word_count=word_count)


# ---------------------------------------------------------------------------
# TestBuildSectionContextBasic
# ---------------------------------------------------------------------------

class TestBuildSectionContextBasic:
    def test_includes_document_title(self):
        section = _make_section()
        blueprint = _make_blueprint(title="My Great Doc")
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "My Great Doc" in ctx

    def test_includes_audience(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief(audience="product managers")
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "product managers" in ctx

    def test_includes_writing_style(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief(style="narrative")
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "narrative" in ctx

    def test_includes_section_position(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            section_index=2,
            total_sections=5,
        )
        assert "3 of 5" in ctx

    def test_includes_section_title(self):
        section = _make_section(title="Deep Dive Analysis")
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "Deep Dive Analysis" in ctx

    def test_includes_word_budget(self):
        section = _make_section(word_budget=750)
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "750" in ctx

    def test_includes_section_description(self):
        section = _make_section(description="Detailed explanation of the core algorithm")
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "Detailed explanation of the core algorithm" in ctx


# ---------------------------------------------------------------------------
# TestBuildSectionContextOutline
# ---------------------------------------------------------------------------

class TestBuildSectionContextOutline:
    def test_includes_global_outline(self):
        s1 = _make_section("s1", title="Introduction")
        s2 = _make_section("s2", title="Methods")
        s3 = _make_section("s3", title="Conclusion")
        blueprint = _make_blueprint(sections=[s1, s2, s3])
        brief = _make_brief()
        ctx = build_section_context(
            section=s2,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            section_index=1,
        )
        assert "Introduction" in ctx
        assert "Methods" in ctx
        assert "Conclusion" in ctx

    def test_current_section_marked_in_outline(self):
        s1 = _make_section("s1", title="Introduction")
        s2 = _make_section("s2", title="Methods")
        blueprint = _make_blueprint(sections=[s1, s2])
        brief = _make_brief()
        ctx = build_section_context(
            section=s2,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            section_index=1,
        )
        # Current section should have >>> marker
        assert ">>> " in ctx

    def test_outline_includes_heading_level(self):
        s1 = _make_section("s1", title="H2 Section", level=2)
        blueprint = _make_blueprint(sections=[s1])
        brief = _make_brief()
        ctx = build_section_context(
            section=s1,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "## H2 Section" in ctx


# ---------------------------------------------------------------------------
# TestBuildSectionContextMustCover
# ---------------------------------------------------------------------------

class TestBuildSectionContextMustCover:
    def test_includes_must_cover_points(self):
        section = _make_section(must_cover=["point alpha", "point beta", "point gamma"])
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "point alpha" in ctx
        assert "point beta" in ctx
        assert "point gamma" in ctx

    def test_no_must_cover_section_no_must_cover_label(self):
        section = _make_section(must_cover=[])
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "Must Cover" not in ctx


# ---------------------------------------------------------------------------
# TestBuildSectionContextContinuity
# ---------------------------------------------------------------------------

class TestBuildSectionContextContinuity:
    def test_includes_prev_section_tail(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            prev_section_tail="This is the ending of the previous section.",
        )
        assert "This is the ending of the previous section." in ctx

    def test_includes_next_section_header(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            next_section_header="Conclusion: wrapping up the findings",
        )
        assert "Conclusion: wrapping up the findings" in ctx

    def test_no_prev_tail_omits_previous_section_ending(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            prev_section_tail="",
        )
        assert "Previous Section Ending" not in ctx

    def test_no_next_header_omits_next_section_topic(self):
        section = _make_section()
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
            next_section_header="",
        )
        assert "Next Section Topic" not in ctx


# ---------------------------------------------------------------------------
# TestBuildSectionContextAssets
# ---------------------------------------------------------------------------

class TestBuildSectionContextAssets:
    def test_includes_referenced_text_asset(self):
        asset = _make_asset("a1", atype="text", content="Important source text content")
        section = _make_section(assets=["a1"])
        blueprint = _make_blueprint()
        brief = _make_brief()
        asset_map = _make_asset_map([asset])
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
        )
        assert "Important source text content" in ctx

    def test_image_asset_shows_url_and_description(self):
        asset = AssetItem(
            id="img-1",
            type="image",
            content="https://example.com/photo.png",
            summary="A photo of the system",
        )
        section = _make_section(assets=["img-1"])
        blueprint = _make_blueprint()
        brief = _make_brief()
        asset_map = _make_asset_map([asset])
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
        )
        assert "https://example.com/photo.png" in ctx
        assert "A photo of the system" in ctx

    def test_excludes_unreferenced_assets(self):
        asset = _make_asset("a1", content="Secret content not referenced")
        section = _make_section(assets=[])  # section doesn't reference a1
        blueprint = _make_blueprint()
        brief = _make_brief()
        asset_map = _make_asset_map([asset])
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
        )
        assert "Secret content not referenced" not in ctx

    def test_long_asset_content_is_truncated(self):
        long_content = "x" * 3000
        asset = _make_asset("a1", content=long_content)
        section = _make_section(assets=["a1"])
        blueprint = _make_blueprint()
        brief = _make_brief()
        asset_map = _make_asset_map([asset])
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
        )
        # Content should be truncated to 2000 chars
        assert "x" * 2001 not in ctx
        assert "x" * 2000 in ctx


# ---------------------------------------------------------------------------
# TestBuildSectionContextVisuals
# ---------------------------------------------------------------------------

class TestBuildSectionContextVisuals:
    def test_mermaid_visual_generates_instruction(self):
        visual = VisualPlan(type="mermaid", description="deployment flow")
        section = _make_section(visuals=[visual])
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "Mermaid" in ctx
        assert "deployment flow" in ctx

    def test_reuse_image_visual_generates_markdown_link(self):
        asset = AssetItem(
            id="img-arch",
            type="image",
            content="https://cdn.example.com/arch.png",
            summary="Architecture diagram",
        )
        visual = VisualPlan(
            type="reuse_image",
            description="System architecture diagram",
            source_asset_id="img-arch",
        )
        section = _make_section(visuals=[visual])
        blueprint = _make_blueprint()
        brief = _make_brief()
        asset_map = _make_asset_map([asset])
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
        )
        assert "https://cdn.example.com/arch.png" in ctx
        assert "![" in ctx  # markdown image syntax

    def test_reuse_image_missing_asset_skipped(self):
        visual = VisualPlan(
            type="reuse_image",
            description="Missing image",
            source_asset_id="nonexistent-id",
        )
        section = _make_section(visuals=[visual])
        blueprint = _make_blueprint()
        brief = _make_brief()
        asset_map = _make_asset_map([])
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
        )
        # Should not crash and should not include broken image
        assert "nonexistent-id" not in ctx

    def test_ai_image_visual_shows_placeholder(self):
        visual = VisualPlan(type="ai_image", description="futuristic robot")
        section = _make_section(visuals=[visual])
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "futuristic robot" in ctx
        assert "AI will generate" in ctx

    def test_table_visual_generates_instruction(self):
        visual = VisualPlan(type="table", description="comparison of options")
        section = _make_section(visuals=[visual])
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "table" in ctx.lower()
        assert "comparison of options" in ctx

    def test_no_visuals_section_has_no_visual_instructions(self):
        section = _make_section(visuals=[])
        blueprint = _make_blueprint()
        brief = _make_brief()
        ctx = build_section_context(
            section=section,
            blueprint=blueprint,
            brief=brief,
            asset_map=None,
        )
        assert "Visual Instructions" not in ctx


# ---------------------------------------------------------------------------
# TestGetPrevSectionTail
# ---------------------------------------------------------------------------

class TestGetPrevSectionTail:
    def test_returns_empty_for_first_section(self):
        drafts = [_make_draft("s1", "Previous content")]
        result = get_prev_section_tail(drafts, 0)
        assert result == ""

    def test_returns_empty_for_empty_drafts(self):
        result = get_prev_section_tail([], 1)
        assert result == ""

    def test_returns_last_paragraph_of_previous(self):
        content = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
        drafts = [_make_draft("s1", content)]
        result = get_prev_section_tail(drafts, 1)
        assert "Third paragraph." in result

    def test_truncates_long_tail(self):
        long_para = "x" * 1000
        content = f"Short intro.\n\n{long_para}"
        drafts = [_make_draft("s1", content)]
        result = get_prev_section_tail(drafts, 1, max_chars=500)
        assert len(result) <= 500

    def test_returns_empty_for_draft_with_no_content(self):
        drafts = [_make_draft("s1", "")]
        result = get_prev_section_tail(drafts, 1)
        assert result == ""

    def test_index_past_drafts_length_returns_empty(self):
        drafts = [_make_draft("s1", "Content")]
        # current_index=5 but we only have 1 draft (index 0)
        result = get_prev_section_tail(drafts, 5)
        assert result == ""

    def test_handles_single_paragraph_content(self):
        content = "Only one paragraph with no double newlines."
        drafts = [_make_draft("s1", content)]
        result = get_prev_section_tail(drafts, 1)
        assert "Only one paragraph" in result


# ---------------------------------------------------------------------------
# TestGetNextSectionHeader
# ---------------------------------------------------------------------------

class TestGetNextSectionHeader:
    def test_returns_empty_for_last_section(self):
        s1 = _make_section("s1")
        s2 = _make_section("s2")
        blueprint = _make_blueprint(sections=[s1, s2])
        result = get_next_section_header(blueprint, 1)  # s2 is last
        assert result == ""

    def test_returns_empty_for_single_section_blueprint(self):
        s1 = _make_section("s1")
        blueprint = _make_blueprint(sections=[s1])
        result = get_next_section_header(blueprint, 0)
        assert result == ""

    def test_returns_next_section_title_and_description(self):
        s1 = _make_section("s1", title="Intro", description="Overview of the topic")
        s2 = _make_section("s2", title="Methods", description="How we did it")
        blueprint = _make_blueprint(sections=[s1, s2])
        result = get_next_section_header(blueprint, 0)
        assert "Methods" in result
        assert "How we did it" in result

    def test_returns_empty_for_empty_sections(self):
        blueprint = _make_blueprint(sections=[])
        result = get_next_section_header(blueprint, 0)
        assert result == ""

    def test_middle_section_returns_next(self):
        s1 = _make_section("s1", title="One")
        s2 = _make_section("s2", title="Two")
        s3 = _make_section("s3", title="Three")
        blueprint = _make_blueprint(sections=[s1, s2, s3])
        result = get_next_section_header(blueprint, 1)
        assert "Three" in result


class _FakeRunResult:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def stream_text(self, delta: bool = True, debounce_by: float | None = 0.1):
        yield "Generated section content"


class _FakeAgent:
    def __init__(self, *args, **kwargs):
        pass

    def run_stream(self, prompt: str):
        return _FakeRunResult()


class _LongStreamingRunResult:
    def __init__(self, chunks: list[str], emitted_chunks: list[str]):
        self._chunks = chunks
        self._emitted_chunks = emitted_chunks

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def stream_text(self, delta: bool = True, debounce_by: float | None = 0.1):
        for chunk in self._chunks:
            self._emitted_chunks.append(chunk)
            yield chunk


class _CleanupSensitiveRunResult:
    def __init__(
        self,
        chunks: list[str],
        *,
        fail_on_debounce_close: bool,
        captured: dict[str, float | None] | None = None,
    ):
        self._chunks = chunks
        self._fail_on_debounce_close = fail_on_debounce_close
        self._captured = captured if captured is not None else {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def stream_text(self, delta: bool = True, debounce_by: float | None = 0.1):
        self._captured["debounce_by"] = debounce_by
        try:
            for chunk in self._chunks:
                yield chunk
        except GeneratorExit:
            if self._fail_on_debounce_close and debounce_by is not None:
                raise RuntimeError("anext(): asynchronous generator is already running")
            raise


class TestWriteSection:
    @pytest.mark.asyncio
    async def test_write_section_does_not_retry_full_generation_when_budget_misses(self):
        section = _make_section("s1", title="Intro", word_budget=300)
        blueprint = _make_blueprint(sections=[section])
        brief = _make_brief()
        prompts: list[str] = []

        class _BudgetMissAgent:
            def __init__(self, *args, **kwargs):
                pass

            def run_stream(self, prompt: str):
                prompts.append(prompt)
                return _FakeRunResult()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.workers.section_writer.create_pydantic_ai_model", lambda: object())
            mp.setattr("pydantic_ai.Agent", _BudgetMissAgent)
            mp.setattr("app.workers.section_writer.emit", AsyncMock())

            draft = await write_section(
                section=section,
                blueprint=blueprint,
                brief=brief,
                asset_map=None,
                section_index=0,
                total_sections=1,
                thread_id="thread-1",
            )

        assert draft.word_count < section.word_budget * 0.8
        assert len(prompts) == 1

    @pytest.mark.asyncio
    async def test_write_section_returns_stable_node_id(self):
        section = _make_section("s1", title="Intro")
        blueprint = _make_blueprint(sections=[section])
        brief = _make_brief()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.workers.section_writer.create_pydantic_ai_model", lambda: object())
            mp.setattr("pydantic_ai.Agent", _FakeAgent)
            mp.setattr("app.workers.section_writer.emit", AsyncMock())

            draft = await write_section(
                section=section,
                blueprint=blueprint,
                brief=brief,
                asset_map=None,
                section_index=0,
                total_sections=1,
                thread_id="thread-1",
            )

        assert draft.section_id == "s1"
        assert draft.node_id == "section:s1"

    @pytest.mark.asyncio
    async def test_write_section_stops_consuming_runaway_streams_after_hard_cap(self):
        section = _make_section("s1", title="Intro", word_budget=10)
        blueprint = _make_blueprint(sections=[section])
        brief = _make_brief()
        emitted_chunks: list[str] = []

        class _LongStreamingAgent:
            def __init__(self, *args, **kwargs):
                pass

            def run_stream(self, prompt: str):
                return _LongStreamingRunResult(["word "] * 200, emitted_chunks)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.workers.section_writer.create_pydantic_ai_model", lambda: object())
            mp.setattr("pydantic_ai.Agent", _LongStreamingAgent)
            mp.setattr("app.workers.section_writer.emit", AsyncMock())

            draft = await write_section(
                section=section,
                blueprint=blueprint,
                brief=brief,
                asset_map=None,
                section_index=0,
                total_sections=1,
                thread_id="thread-1",
                max_retries=0,
            )

        assert draft.word_count <= 90
        assert len(emitted_chunks) < 200

    @pytest.mark.asyncio
    async def test_write_section_avoids_debounced_stream_cleanup_error_when_hard_cap_trips(self):
        section = _make_section("s1", title="Intro", word_budget=10)
        blueprint = _make_blueprint(sections=[section])
        brief = _make_brief()
        captured: dict[str, float | None] = {}

        class _CleanupSensitiveAgent:
            def __init__(self, *args, **kwargs):
                pass

            def run_stream(self, prompt: str):
                return _CleanupSensitiveRunResult(
                    ["word "] * 200,
                    fail_on_debounce_close=True,
                    captured=captured,
                )

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.workers.section_writer.create_pydantic_ai_model", lambda: object())
            mp.setattr("pydantic_ai.Agent", _CleanupSensitiveAgent)
            mp.setattr("app.workers.section_writer.emit", AsyncMock())

            draft = await write_section(
                section=section,
                blueprint=blueprint,
                brief=brief,
                asset_map=None,
                section_index=0,
                total_sections=1,
                thread_id="thread-1",
                max_retries=0,
            )

        assert captured["debounce_by"] is None
        assert draft.word_count <= 90
