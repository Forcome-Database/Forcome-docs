"""Tests for create_blueprint orchestrator tool."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan, VisualPlan
from app.models.brief import CreationBrief
from app.orchestrator.tools.create_blueprint import (
    _normalize_word_budgets,
    _summarize_brief,
    _summarize_assets_for_blueprint,
    build_blueprint_prompt,
    classify_blueprint_delta,
    generate_blueprint,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_brief(
    audience: str = "developers",
    goal: str = "explain the system",
    target_length: int = 1000,
    style: str = "technical",
    tone: str = "professional",
    structure_strategy: str = "ai_recommend",
    image_strategy: str = "mixed",
    constraints: list | None = None,
) -> CreationBrief:
    return CreationBrief(
        audience=audience,
        goal=goal,
        target_length=target_length,
        style=style,
        tone=tone,
        structure_strategy=structure_strategy,  # type: ignore[arg-type]
        image_strategy=image_strategy,  # type: ignore[arg-type]
        constraints=constraints or [],
    )


def _make_asset_map(with_images: bool = False) -> AssetMap:
    items = [
        AssetItem(
            id="heading-001",
            type="heading_structure",
            source="doc.pdf",
            content=json.dumps([
                {"level": 1, "text": "Introduction"},
                {"level": 2, "text": "Background"},
                {"level": 2, "text": "Conclusion"},
            ]),
            summary="3 headings",
        ),
        AssetItem(
            id="text-001",
            type="text",
            source="doc.pdf",
            content="Sample text content for the introduction section.",
            summary="Section 'Introduction' — 80 words",
        ),
    ]
    if with_images:
        items.append(AssetItem(
            id="img-001",
            type="image",
            source="doc.pdf",
            content="http://example.com/img.png",
            summary="[diagram] Architecture diagram showing system components",
        ))
    return AssetMap(
        items=items,
        source_structure=[
            {"level": 1, "text": "Introduction"},
            {"level": 2, "text": "Background"},
            {"level": 2, "text": "Conclusion"},
        ],
        source_word_count=500,
    )


def _make_image_candidate(asset_id: str = "img-001", score: float = 0.9) -> dict:
    return {
        "asset_id": asset_id,
        "score": score,
        "caption": "Architecture diagram",
        "source": "doc.pdf",
        "source_page": 2,
        "source_heading": "Architecture",
        "rationale": "Matches architecture keywords",
    }


def _make_llm_response(sections_data: list[dict], title: str = "Test Doc", total_budget: int = 1000) -> dict:
    return {
        "title": title,
        "total_word_budget": total_budget,
        "sections": sections_data,
    }


def _make_sections_data(n: int = 3, budget_per: int = 300) -> list[dict]:
    return [
        {
            "id": f"s{i + 1}",
            "title": f"Section {i + 1}",
            "level": 2,
            "word_budget": budget_per,
            "description": f"Description for section {i + 1}",
            "assets": [],
            "must_cover": [f"Point {i + 1}"],
        }
        for i in range(n)
    ]


def _make_blueprint_for_delta(
    *,
    title: str = "Test Doc",
    total_word_budget: int = 1000,
    image_visual_type: str = "ai_image",
) -> CreationBlueprint:
    return CreationBlueprint(
        title=title,
        total_word_budget=total_word_budget,
        sections=[
            SectionPlan(
                id="s1",
                title="Overview",
                level=2,
                word_budget=400,
                description="Explain the system",
                assets=["asset-1"],
                visuals=[
                    VisualPlan(
                        type=image_visual_type,  # type: ignore[arg-type]
                        description="System overview illustration",
                        position="before_section",
                    )
                ],
                must_cover=["context", "scope"],
            ),
            SectionPlan(
                id="s2",
                title="Workflow",
                level=2,
                word_budget=600,
                description="Describe the workflow",
                assets=["asset-2"],
                must_cover=["steps", "handoff"],
            ),
        ],
        style_guide="Be concrete",
        visual_plan_summary="One lead visual.",
    )


# ---------------------------------------------------------------------------
# _summarize_brief
# ---------------------------------------------------------------------------

class TestSummarizeBrief:
    def test_includes_audience(self):
        brief = _make_brief(audience="students")
        result = _summarize_brief(brief)
        assert "students" in result

    def test_includes_goal(self):
        brief = _make_brief(goal="teach Python")
        result = _summarize_brief(brief)
        assert "teach Python" in result

    def test_includes_target_length(self):
        brief = _make_brief(target_length=1500)
        result = _summarize_brief(brief)
        assert "1500" in result

    def test_includes_structure_strategy(self):
        brief = _make_brief(structure_strategy="copy_source")
        result = _summarize_brief(brief)
        assert "copy_source" in result

    def test_includes_constraints(self):
        brief = _make_brief(constraints=["no jargon", "keep it short"])
        result = _summarize_brief(brief)
        assert "no jargon" in result

    def test_empty_brief(self):
        brief = CreationBrief()
        result = _summarize_brief(brief)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# _summarize_assets_for_blueprint
# ---------------------------------------------------------------------------

class TestSummarizeAssetsForBlueprint:
    def test_empty_asset_map(self):
        result = _summarize_assets_for_blueprint(AssetMap())
        assert "(no assets)" in result

    def test_includes_asset_ids(self):
        am = _make_asset_map()
        result = _summarize_assets_for_blueprint(am)
        assert "heading-001" in result
        assert "text-001" in result

    def test_includes_asset_types(self):
        am = _make_asset_map()
        result = _summarize_assets_for_blueprint(am)
        assert "HEADING_STRUCTURE" in result or "heading_structure" in result.lower()
        assert "TEXT" in result or "text" in result.lower()

    def test_includes_image_assets(self):
        am = _make_asset_map(with_images=True)
        result = _summarize_assets_for_blueprint(am)
        assert "img-001" in result


# ---------------------------------------------------------------------------
# build_blueprint_prompt
# ---------------------------------------------------------------------------

class TestBuildBlueprintPrompt:
    def test_includes_user_message(self):
        brief = _make_brief()
        prompt = build_blueprint_prompt("Write a system guide", brief, None)
        assert "Write a system guide" in prompt

    def test_includes_brief_summary(self):
        brief = _make_brief(audience="engineers", goal="document the API")
        prompt = build_blueprint_prompt("Write", brief, None)
        assert "engineers" in prompt
        assert "document the API" in prompt

    def test_includes_asset_summary_when_provided(self):
        brief = _make_brief()
        am = _make_asset_map()
        prompt = build_blueprint_prompt("Write", brief, am)
        assert "heading-001" in prompt or "text-001" in prompt

    def test_copy_source_includes_source_structure(self):
        brief = _make_brief(structure_strategy="copy_source")
        am = _make_asset_map()
        prompt = build_blueprint_prompt("Write", brief, am)
        assert "Introduction" in prompt
        assert "Background" in prompt

    def test_ai_recommend_no_structure_hint(self):
        brief = _make_brief(structure_strategy="ai_recommend")
        am = _make_asset_map()
        prompt = build_blueprint_prompt("Write", brief, am)
        # Should not include "copy_source mode" hint
        assert "copy_source mode" not in prompt

    def test_contains_json_spec(self):
        brief = _make_brief()
        prompt = build_blueprint_prompt("Write", brief, None)
        assert "word_budget" in prompt
        assert "sections" in prompt
        assert "must_cover" in prompt

    def test_no_assets_case(self):
        brief = _make_brief()
        prompt = build_blueprint_prompt("Write a report", brief, None)
        assert "Write a report" in prompt
        # Should still include the JSON spec
        assert "sections" in prompt


# ---------------------------------------------------------------------------
# _normalize_word_budgets
# ---------------------------------------------------------------------------

class TestNormalizeWordBudgets:
    def _make_blueprint(self, budgets: list[int], total: int) -> CreationBlueprint:
        sections = [
            SectionPlan(id=f"s{i}", title=f"S{i}", word_budget=b)
            for i, b in enumerate(budgets)
        ]
        return CreationBlueprint(sections=sections, total_word_budget=total)

    def test_within_tolerance_unchanged(self):
        bp = self._make_blueprint([300, 300, 400], total=1000)
        result = _normalize_word_budgets(bp)
        assert sum(s.word_budget for s in result.sections) == 1000

    def test_over_budget_scaled_down(self):
        # 600 + 600 + 600 = 1800, total=1000 → needs scaling
        bp = self._make_blueprint([600, 600, 600], total=1000)
        result = _normalize_word_budgets(bp)
        total = sum(s.word_budget for s in result.sections)
        assert total == 1000

    def test_under_budget_scaled_up(self):
        # 100 + 100 + 100 = 300, total=1000 → needs scaling
        bp = self._make_blueprint([100, 100, 100], total=1000)
        result = _normalize_word_budgets(bp)
        total = sum(s.word_budget for s in result.sections)
        assert total == 1000

    def test_zero_budgets_distributed_evenly(self):
        bp = self._make_blueprint([0, 0, 0], total=900)
        result = _normalize_word_budgets(bp)
        total = sum(s.word_budget for s in result.sections)
        assert total == 900
        for s in result.sections:
            assert s.word_budget > 0

    def test_empty_sections_unchanged(self):
        bp = CreationBlueprint(sections=[], total_word_budget=1000)
        result = _normalize_word_budgets(bp)
        assert result.sections == []

    def test_zero_total_budget_unchanged(self):
        bp = self._make_blueprint([300, 300], total=0)
        result = _normalize_word_budgets(bp)
        # No normalization when total_word_budget=0
        assert sum(s.word_budget for s in result.sections) == 600


# ---------------------------------------------------------------------------
# generate_blueprint
# ---------------------------------------------------------------------------

class TestGenerateBlueprint:
    @pytest.mark.asyncio
    async def test_returns_creation_blueprint(self):
        sections_data = _make_sections_data(3, 333)
        llm_data = _make_llm_response(sections_data, "My Document", 1000)

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write a system guide",
                brief=_make_brief(target_length=1000),
                asset_map=None,
                thread_id="t1",
            )

        assert isinstance(result, CreationBlueprint)
        assert result.title == "My Document"
        assert len(result.sections) == 3
        assert result.total_word_budget == 1000

    @pytest.mark.asyncio
    async def test_sections_parsed_correctly(self):
        sections_data = [
            {
                "id": "s1",
                "title": "Introduction",
                "level": 1,
                "word_budget": 200,
                "description": "Overview",
                "assets": ["text-001"],
                "must_cover": ["background", "motivation"],
            },
            {
                "id": "s2",
                "title": "Details",
                "level": 2,
                "word_budget": 800,
                "description": "Technical details",
                "assets": [],
                "must_cover": [],
            },
        ]
        llm_data = _make_llm_response(sections_data, total_budget=1000)

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write docs",
                brief=_make_brief(target_length=1000),
                asset_map=None,
                thread_id="t1",
            )

        assert result.sections[0].title == "Introduction"
        assert result.sections[0].level == 1
        assert "text-001" in result.sections[0].assets
        assert "background" in result.sections[0].must_cover

    @pytest.mark.asyncio
    async def test_word_budget_normalization_applied(self):
        """Sections with off budgets should be normalized."""
        sections_data = _make_sections_data(3, 1000)  # 3000 total, budget is 1000
        llm_data = _make_llm_response(sections_data, total_budget=1000)

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write",
                brief=_make_brief(target_length=1000),
                asset_map=None,
                thread_id="t1",
            )

        total = sum(s.word_budget for s in result.sections)
        assert total == 1000

    @pytest.mark.asyncio
    async def test_copy_source_with_source_structure(self):
        """copy_source strategy with asset_map.source_structure."""
        brief = _make_brief(structure_strategy="copy_source", target_length=500)
        am = _make_asset_map()
        sections_data = _make_sections_data(3, 167)
        llm_data = _make_llm_response(sections_data, total_budget=500)

        captured_prompts: list[str] = []

        async def fake_llm(prompt: str) -> dict:
            captured_prompts.append(prompt)
            return llm_data

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                side_effect=fake_llm,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Recreate this document",
                brief=brief,
                asset_map=am,
                thread_id="t1",
            )

        assert isinstance(result, CreationBlueprint)
        # The prompt should contain the source structure hint
        assert len(captured_prompts) == 1
        assert "Introduction" in captured_prompts[0]
        assert "copy_source" in captured_prompts[0]

    @pytest.mark.asyncio
    async def test_no_assets_case(self):
        """Blueprint generation with no assets should still work."""
        sections_data = _make_sections_data(2, 500)
        llm_data = _make_llm_response(sections_data, total_budget=1000)

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write a blog post",
                brief=_make_brief(target_length=1000),
                asset_map=None,
                thread_id="t1",
            )

        assert isinstance(result, CreationBlueprint)
        assert len(result.sections) == 2

    @pytest.mark.asyncio
    async def test_empty_llm_response_gives_empty_blueprint(self):
        """Empty LLM response should result in an empty but valid blueprint."""
        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write something",
                brief=_make_brief(target_length=800),
                asset_map=None,
                thread_id="t1",
            )

        assert isinstance(result, CreationBlueprint)
        assert result.sections == []

    @pytest.mark.asyncio
    async def test_sse_events_emitted(self):
        sections_data = _make_sections_data(2, 400)
        llm_data = _make_llm_response(sections_data, total_budget=800)

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch(
                "app.orchestrator.tools.create_blueprint.emit",
                new_callable=AsyncMock,
            ) as mock_emit,
        ):
            await generate_blueprint(
                user_message="Write",
                brief=_make_brief(),
                asset_map=None,
                thread_id="t42",
            )

        assert mock_emit.call_count == 2
        calls = [c[0][1] for c in mock_emit.call_args_list]
        event_types = [c["type"] for c in calls]
        assert "step_start" in event_types
        assert "step_done" in event_types

    @pytest.mark.asyncio
    async def test_brief_target_length_used_as_fallback(self):
        """When LLM omits total_word_budget, use brief.target_length."""
        sections_data = _make_sections_data(2, 400)
        llm_data = {"title": "Doc", "sections": sections_data}  # no total_word_budget

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write",
                brief=_make_brief(target_length=1200),
                asset_map=None,
                thread_id="t1",
            )

        assert result.total_word_budget == 1200

    @pytest.mark.asyncio
    async def test_invalid_section_skipped_gracefully(self):
        """Sections with missing or invalid fields should be skipped."""
        llm_data = {
            "title": "My Doc",
            "total_word_budget": 500,
            "sections": [
                {"id": "s1", "title": "Good Section", "word_budget": 500},
                "not a dict",  # invalid
                None,  # invalid
            ],
        }

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write",
                brief=_make_brief(target_length=500),
                asset_map=None,
                thread_id="t1",
            )

        assert len(result.sections) == 1
        assert result.sections[0].title == "Good Section"

    @pytest.mark.asyncio
    async def test_title_fallback_to_user_message(self):
        """When LLM omits title, use the first 60 chars of user_message."""
        sections_data = _make_sections_data(1, 500)
        llm_data = {"sections": sections_data, "total_word_budget": 500}  # no title

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write a comprehensive technical guide for new engineers",
                brief=_make_brief(target_length=500),
                asset_map=None,
                thread_id="t1",
            )

        assert result.title != ""
        assert "Write" in result.title

    @pytest.mark.asyncio
    async def test_generate_new_image_strategy_adds_ai_image_fallback(self):
        llm_data = _make_llm_response(
            [
                {
                    "id": "s1",
                    "title": "Overview",
                    "level": 2,
                    "word_budget": 500,
                    "description": "Architecture overview",
                    "assets": [],
                    "visuals": [],
                    "must_cover": ["system layout"],
                }
            ],
            title="Doc",
            total_budget=500,
        )

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write a system overview with visuals",
                brief=_make_brief(image_strategy="generate_new", target_length=500),
                asset_map=None,
                thread_id="t1",
            )

        assert any(v.type == "ai_image" for v in result.sections[0].visuals)

    @pytest.mark.asyncio
    async def test_canonical_image_strategy_prefers_source_candidates(self):
        llm_data = {
            "title": "Doc",
            "total_word_budget": 500,
            "sections": [
                {
                    "id": "s1",
                    "title": "Overview",
                    "level": 2,
                    "word_budget": 500,
                    "description": "Architecture overview",
                    "assets": [],
                    "visual_candidates": [_make_image_candidate()],
                    "visuals": [
                        {
                            "type": "reuse_image",
                            "description": "Reuse the source architecture diagram",
                            "source_asset_id": "img-001",
                            "position": "before_section",
                        }
                    ],
                    "must_cover": ["system layout"],
                }
            ],
        }

        with (
            patch(
                "app.orchestrator.tools.create_blueprint._call_llm_for_blueprint",
                new_callable=AsyncMock,
                return_value=llm_data,
            ),
            patch("app.orchestrator.tools.create_blueprint.emit", new_callable=AsyncMock),
        ):
            result = await generate_blueprint(
                user_message="Write a source-aware system overview",
                brief=_make_brief(image_strategy="reuse_source", target_length=500),
                asset_map=_make_asset_map(with_images=True),
                thread_id="t1",
            )

        assert result.sections[0].visual_candidates[0].asset_id == "img-001"
        assert result.sections[0].visuals[0].type == "reuse_image"


class TestClassifyBlueprintDelta:
    def test_allows_must_cover_updates_as_auto_patch(self):
        confirmed = _make_blueprint_for_delta()
        patched = confirmed.model_copy(deep=True)
        patched.sections[0].must_cover.append("success metrics")

        result = classify_blueprint_delta(confirmed, patched)

        assert result.decision == "auto_patch"
        assert any("must_cover" in change for change in result.changes)

    def test_allows_asset_reassignment_as_auto_patch(self):
        confirmed = _make_blueprint_for_delta()
        patched = confirmed.model_copy(deep=True)
        patched.sections[0].assets = ["asset-3", "asset-4"]

        result = classify_blueprint_delta(confirmed, patched)

        assert result.decision == "auto_patch"
        assert any("assets" in change for change in result.changes)

    def test_allows_single_section_budget_change_within_fifteen_percent(self):
        confirmed = _make_blueprint_for_delta()
        patched = confirmed.model_copy(deep=True)
        patched.sections[0].word_budget = 460
        patched.total_word_budget = 1060

        result = classify_blueprint_delta(confirmed, patched)

        assert result.decision == "auto_patch"
        assert any("word_budget" in change for change in result.changes)

    def test_allows_visual_prompt_wording_change_without_strategy_change(self):
        confirmed = _make_blueprint_for_delta()
        patched = confirmed.model_copy(deep=True)
        patched.sections[0].visuals[0].description = "Annotated system overview illustration"

        result = classify_blueprint_delta(confirmed, patched)

        assert result.decision == "auto_patch"
        assert any("visual" in change for change in result.changes)

    @pytest.mark.parametrize(
        ("mutation", "expected_change"),
        [
            (
                lambda bp: bp.sections.append(
                    SectionPlan(id="s3", title="Appendix", level=2, word_budget=100)
                ),
                "section set",
            ),
            (
                lambda bp: bp.sections.__setitem__(slice(None), [bp.sections[1], bp.sections[0]]),
                "section order",
            ),
            (
                lambda bp: setattr(bp, "title", "Renamed Doc"),
                "title",
            ),
            (
                lambda bp: setattr(bp, "total_word_budget", 1200),
                "total_word_budget",
            ),
            (
                lambda bp: setattr(bp.sections[0].visuals[0], "type", "reuse_image"),
                "image strategy",
            ),
        ],
    )
    def test_requires_reconfirmation_for_major_blueprint_changes(self, mutation, expected_change):
        confirmed = _make_blueprint_for_delta()
        patched = confirmed.model_copy(deep=True)
        mutation(patched)

        result = classify_blueprint_delta(confirmed, patched)

        assert result.decision == "reconfirm_blueprint"
        assert any(expected_change in change for change in result.changes)
