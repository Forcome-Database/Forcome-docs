"""Tests for create_brief orchestrator tool."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.models.brief import CreationBrief
from app.orchestrator.tools.create_brief import (
    _summarize_asset_map,
    build_brief_prompt,
    generate_brief,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_asset_map(word_count: int = 200, has_items: bool = True) -> AssetMap:
    items = []
    if has_items:
        items = [
            AssetItem(
                id="heading-abc",
                type="heading_structure",
                source="doc.pdf",
                content=json.dumps([
                    {"level": 1, "text": "Introduction"},
                    {"level": 2, "text": "Background"},
                ]),
                summary="2 headings",
            ),
            AssetItem(
                id="text-def",
                type="text",
                source="doc.pdf",
                content="Sample text content.",
                summary="Section 'Introduction' — 50 words",
            ),
        ]
    return AssetMap(
        items=items,
        source_word_count=word_count,
        source_section_counts={"Introduction": 50, "Background": 150},
        source_structure=[{"level": 1, "text": "Introduction"}],
    )


def _make_llm_response(data: dict) -> MagicMock:
    """Create a fake pydantic_ai agent.run() result."""
    mock_result = MagicMock()
    mock_result.output = json.dumps(data)
    return mock_result


# ---------------------------------------------------------------------------
# _summarize_asset_map
# ---------------------------------------------------------------------------

class TestSummarizeAssetMap:
    def test_empty_asset_map(self):
        result = _summarize_asset_map(AssetMap())
        assert "(no assets)" in result

    def test_includes_word_count(self):
        am = _make_asset_map(word_count=500)
        result = _summarize_asset_map(am)
        assert "500" in result

    def test_includes_type_counts(self):
        am = _make_asset_map()
        result = _summarize_asset_map(am)
        assert "text" in result
        assert "heading_structure" in result

    def test_includes_heading_texts(self):
        am = _make_asset_map()
        result = _summarize_asset_map(am)
        assert "Introduction" in result


# ---------------------------------------------------------------------------
# build_brief_prompt
# ---------------------------------------------------------------------------

class TestBuildBriefPrompt:
    def test_includes_user_message(self):
        prompt = build_brief_prompt("Write a blog post", None, None, None)
        assert "Write a blog post" in prompt

    def test_includes_template_prompt(self):
        prompt = build_brief_prompt("Write", None, None, "Use formal tone.")
        assert "Use formal tone." in prompt

    def test_includes_asset_summary_when_provided(self):
        am = _make_asset_map(word_count=300)
        prompt = build_brief_prompt("Write", am, None, None)
        assert "300" in prompt

    def test_excludes_asset_summary_when_no_items(self):
        am = AssetMap()  # empty
        prompt = build_brief_prompt("Write", am, None, None)
        # "Source word count: 0" should not appear (empty asset map)
        assert "Source word count" not in prompt

    def test_includes_page_content_snippet(self):
        prompt = build_brief_prompt("Write", None, "Existing page content here.", None)
        assert "Existing page content here." in prompt

    def test_page_content_truncated_at_600(self):
        long_content = "x" * 1000
        prompt = build_brief_prompt("Write", None, long_content, None)
        # The prompt should contain the 600-char snippet
        assert "x" * 600 in prompt
        assert "x" * 1000 not in prompt

    def test_returns_string(self):
        result = build_brief_prompt("Write", None, None, None)
        assert isinstance(result, str)

    def test_contains_json_spec(self):
        result = build_brief_prompt("Write", None, None, None)
        assert "audience" in result
        assert "target_length" in result
        assert "structure_strategy" in result


# ---------------------------------------------------------------------------
# generate_brief
# ---------------------------------------------------------------------------

class TestGenerateBrief:
    @pytest.mark.asyncio
    async def test_returns_creation_brief(self):
        llm_data = {
            "audience": "developers",
            "goal": "explain the API",
            "target_length": 800,
            "style": "technical",
            "tone": "neutral",
            "structure_strategy": "ai_recommend",
            "image_strategy": "none",
            "constraints": [],
        }

        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Write an API guide",
                asset_map=None,
                page_content=None,
                template_prompt=None,
                thread_id="t1",
            )

        assert isinstance(result, CreationBrief)
        assert result.audience == "developers"
        assert result.target_length == 800
        assert result.tone == "neutral"

    @pytest.mark.asyncio
    async def test_source_word_count_seeds_target_length(self):
        """When source_word_count > 0 and LLM omits target_length, use source count."""
        asset_map = _make_asset_map(word_count=1500)

        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={
                    "audience": "general",
                    "goal": "summarize",
                    # no target_length key
                },
            ),
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Summarize this document",
                asset_map=asset_map,
                page_content=None,
                template_prompt=None,
                thread_id="t1",
            )

        assert result.target_length == 1500

    @pytest.mark.asyncio
    async def test_llm_target_length_overrides_source_count(self):
        """When LLM provides target_length explicitly, it wins over source_word_count."""
        asset_map = _make_asset_map(word_count=1000)

        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={
                    "audience": "general",
                    "target_length": 300,
                },
            ),
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Write a short version",
                asset_map=asset_map,
                page_content=None,
                template_prompt=None,
                thread_id="t1",
            )

        # LLM explicitly specified 300, so source_wc (1000) should not override
        assert result.target_length == 300

    @pytest.mark.asyncio
    async def test_with_no_assets(self):
        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={"audience": "students", "goal": "teach"},
            ),
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Create a tutorial",
                asset_map=None,
                page_content=None,
                template_prompt=None,
                thread_id="t1",
            )

        assert isinstance(result, CreationBrief)
        assert result.audience == "students"
        # target_length defaults to 0 (no source, LLM didn't provide)
        assert result.target_length == 0

    @pytest.mark.asyncio
    async def test_with_template_context(self):
        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={
                    "structure_strategy": "user_defined",
                    "tone": "formal",
                },
            ) as mock_llm,
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Write a report",
                asset_map=None,
                page_content=None,
                template_prompt="Follow the company report template.",
                thread_id="t1",
            )

        # Verify the prompt passed to LLM contains template context
        call_args = mock_llm.call_args
        prompt_arg = call_args[0][0]
        assert "company report template" in prompt_arg

        assert result.structure_strategy == "user_defined"
        assert result.tone == "formal"

    @pytest.mark.asyncio
    async def test_empty_llm_response_gives_default_brief(self):
        """If LLM returns empty dict, CreationBrief should still be valid with defaults."""
        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Write something",
                asset_map=None,
                page_content=None,
                template_prompt=None,
                thread_id="t1",
            )

        assert isinstance(result, CreationBrief)
        assert result.audience == ""
        assert result.target_length == 0
        assert result.structure_strategy == "ai_recommend"

    @pytest.mark.asyncio
    async def test_invalid_strategy_values_ignored(self):
        """LLM returning invalid enum values should not crash; defaults are used."""
        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={
                    "structure_strategy": "invalid_strategy",
                    "image_strategy": "invalid_image",
                },
            ),
            patch("app.orchestrator.tools.create_brief.emit", new_callable=AsyncMock),
        ):
            result = await generate_brief(
                user_message="Write",
                asset_map=None,
                page_content=None,
                template_prompt=None,
                thread_id="t1",
            )

        # Invalid values should fall back to model defaults
        assert result.structure_strategy == "ai_recommend"
        assert result.image_strategy == "mixed"

    @pytest.mark.asyncio
    async def test_sse_events_emitted(self):
        with (
            patch(
                "app.orchestrator.tools.create_brief._call_llm_for_brief",
                new_callable=AsyncMock,
                return_value={"audience": "all"},
            ),
            patch(
                "app.orchestrator.tools.create_brief.emit",
                new_callable=AsyncMock,
            ) as mock_emit,
        ):
            await generate_brief(
                user_message="Write",
                asset_map=None,
                page_content=None,
                template_prompt=None,
                thread_id="t42",
            )

        # Should emit step_start and step_done
        assert mock_emit.call_count == 2
        calls = [c[0][1] for c in mock_emit.call_args_list]
        event_types = [c["type"] for c in calls]
        assert "step_start" in event_types
        assert "step_done" in event_types
