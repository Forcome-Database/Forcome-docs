"""Tests for VisualPlanner Worker."""
from __future__ import annotations

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import SectionPlan, VisualPlan
from app.models.brief import CreationBrief
from app.workers.visual_planner import (
    _find_matching_image,
    _needs_mermaid,
    _needs_table,
    plan_visuals,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_section(
    sid: str = "s1",
    title: str = "Section",
    description: str = "",
    must_cover: list[str] | None = None,
    visuals: list[VisualPlan] | None = None,
) -> SectionPlan:
    return SectionPlan(
        id=sid,
        title=title,
        description=description,
        must_cover=must_cover or [],
        visuals=visuals or [],
        word_budget=300,
    )


def _make_image(
    img_id: str,
    summary: str = "image description",
    content: str = "http://example.com/img.png",
) -> AssetItem:
    return AssetItem(
        id=img_id,
        type="image",
        source="doc.pdf",
        content=content,
        summary=summary,
    )


def _make_brief(image_strategy: str = "mixed") -> CreationBrief:
    return CreationBrief(image_strategy=image_strategy)  # type: ignore[arg-type]


def _make_asset_map(images: list[AssetItem] | None = None) -> AssetMap:
    items: list[AssetItem] = []
    if images:
        items.extend(images)
    return AssetMap(items=items)


# ---------------------------------------------------------------------------
# _needs_mermaid
# ---------------------------------------------------------------------------

class TestNeedsMermaid:
    def test_detects_workflow_english(self):
        assert _needs_mermaid("This section describes the workflow") is True

    def test_detects_sequence(self):
        assert _needs_mermaid("sequence of steps in the process") is True

    def test_detects_architecture(self):
        assert _needs_mermaid("The system architecture overview") is True

    def test_detects_pipeline(self):
        assert _needs_mermaid("CI/CD pipeline stages") is True

    def test_detects_chinese_flowchart(self):
        assert _needs_mermaid("系统的整体架构和工作流程") is True

    def test_detects_chinese_steps(self):
        assert _needs_mermaid("执行的步骤和顺序") is True

    def test_no_match_plain_text(self):
        assert _needs_mermaid("This section describes background information") is False

    def test_no_match_comparison_text(self):
        assert _needs_mermaid("Compare parameters A vs B") is False

    def test_case_insensitive(self):
        assert _needs_mermaid("WORKFLOW DIAGRAM") is True


# ---------------------------------------------------------------------------
# _needs_table
# ---------------------------------------------------------------------------

class TestNeedsTable:
    def test_detects_compare(self):
        assert _needs_table("Compare features between versions") is True

    def test_detects_parameters(self):
        assert _needs_table("Configuration parameters and their defaults") is True

    def test_detects_vs(self):
        assert _needs_table("Option A vs Option B") is True

    def test_detects_chinese_compare(self):
        assert _needs_table("两种方案的对比分析") is True

    def test_detects_chinese_configuration(self):
        assert _needs_table("系统配置参数说明") is True

    def test_detects_specifications(self):
        assert _needs_table("Technical specs and performance metrics") is True

    def test_no_match_plain_text(self):
        assert _needs_table("Background and motivation for the project") is False

    def test_no_match_workflow_text(self):
        assert _needs_table("Describe the deployment workflow") is False

    def test_case_insensitive(self):
        assert _needs_table("COMPARISON TABLE") is True


# ---------------------------------------------------------------------------
# _find_matching_image
# ---------------------------------------------------------------------------

class TestFindMatchingImage:
    def test_returns_none_for_empty_images(self):
        result = _find_matching_image("some text about architecture", [])
        assert result is None

    def test_returns_none_for_empty_text(self):
        img = _make_image("img-1", summary="architecture diagram")
        result = _find_matching_image("", [img])
        assert result is None

    def test_returns_matching_image(self):
        img = _make_image("img-1", summary="[diagram] System architecture overview")
        result = _find_matching_image("System architecture components", [img])
        assert result is not None
        assert result.id == "img-1"

    def test_returns_best_match_among_multiple(self):
        img1 = _make_image("img-1", summary="[photo] sunset landscape photo")
        img2 = _make_image("img-2", summary="[diagram] deployment architecture diagram")
        # "deployment architecture" should match img2 better
        result = _find_matching_image("Deployment architecture diagram", [img1, img2])
        assert result is not None
        assert result.id == "img-2"

    def test_no_match_returns_none(self):
        img = _make_image("img-1", summary="sunset beach vacation photo")
        result = _find_matching_image("Technical API documentation reference", [img])
        assert result is None

    def test_chinese_keyword_matching(self):
        img = _make_image("img-1", summary="[diagram] 系统架构图")
        result = _find_matching_image("系统架构设计", [img])
        assert result is not None


# ---------------------------------------------------------------------------
# plan_visuals — "none" strategy
# ---------------------------------------------------------------------------

class TestPlanVisualsNoneStrategy:
    def test_skips_all_suggestions_when_none(self):
        sections = [
            _make_section("s1", description="The workflow pipeline stages"),
            _make_section("s2", description="Compare parameters A vs B"),
        ]
        brief = _make_brief(image_strategy="none")
        result = plan_visuals(sections, None, brief)
        for section in result:
            assert section.visuals == []

    def test_skips_image_reuse_when_none(self):
        img = _make_image("img-1", summary="architecture diagram overview")
        am = _make_asset_map([img])
        sections = [_make_section("s1", description="architecture diagram overview")]
        brief = _make_brief(image_strategy="none")
        result = plan_visuals(sections, am, brief)
        assert result[0].visuals == []


# ---------------------------------------------------------------------------
# plan_visuals — mermaid detection
# ---------------------------------------------------------------------------

class TestPlanVisualsMermaid:
    def test_adds_mermaid_for_workflow_section(self):
        sections = [_make_section("s1", description="Describes the deployment workflow stages")]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert len(result[0].visuals) == 1
        assert result[0].visuals[0].type == "mermaid"

    def test_adds_mermaid_for_architecture_must_cover(self):
        sections = [_make_section("s1", must_cover=["system architecture", "component interaction"])]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert len(result[0].visuals) == 1
        assert result[0].visuals[0].type == "mermaid"

    def test_no_mermaid_for_plain_section(self):
        sections = [_make_section("s1", description="Background information")]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert result[0].visuals == []


# ---------------------------------------------------------------------------
# plan_visuals — table detection
# ---------------------------------------------------------------------------

class TestPlanVisualsTable:
    def test_adds_table_for_comparison_section(self):
        sections = [_make_section("s1", description="Compare configuration parameters between versions")]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert len(result[0].visuals) == 1
        assert result[0].visuals[0].type == "table"

    def test_adds_table_for_specs_must_cover(self):
        sections = [_make_section("s1", must_cover=["performance metrics", "comparison table"])]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert len(result[0].visuals) == 1
        assert result[0].visuals[0].type == "table"


# ---------------------------------------------------------------------------
# plan_visuals — image reuse detection
# ---------------------------------------------------------------------------

class TestPlanVisualsImageReuse:
    def test_reuses_matching_image(self):
        img = _make_image("img-arch", summary="[diagram] System architecture overview")
        am = _make_asset_map([img])
        sections = [_make_section("s1", description="System architecture components")]
        brief = _make_brief(image_strategy="reuse_source")
        result = plan_visuals(sections, am, brief)
        assert len(result[0].visuals) == 1
        assert result[0].visuals[0].type == "reuse_image"
        assert result[0].visuals[0].source_asset_id == "img-arch"

    def test_image_takes_priority_over_mermaid(self):
        """If both an image matches AND mermaid keywords exist, prefer image."""
        img = _make_image("img-1", summary="[diagram] deployment pipeline architecture")
        am = _make_asset_map([img])
        # Section has both workflow keywords AND image match
        sections = [_make_section(
            "s1",
            description="deployment pipeline architecture workflow",
        )]
        brief = _make_brief()
        result = plan_visuals(sections, am, brief)
        assert len(result[0].visuals) == 1
        assert result[0].visuals[0].type == "reuse_image"


# ---------------------------------------------------------------------------
# plan_visuals — general behavior
# ---------------------------------------------------------------------------

class TestPlanVisualsGeneral:
    def test_section_with_no_visual_needs(self):
        sections = [_make_section("s1", description="Historical background and context")]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert result[0].visuals == []

    def test_preserves_existing_visuals(self):
        existing = VisualPlan(type="ai_image", description="Existing visual")
        sections = [_make_section("s1", description="Background", visuals=[existing])]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        # Existing visual is preserved
        assert any(v.type == "ai_image" for v in result[0].visuals)

    def test_multiple_sections_independent(self):
        sections = [
            _make_section("s1", description="Deployment workflow pipeline"),
            _make_section("s2", description="Compare parameter configurations"),
            _make_section("s3", description="Introduction and overview"),
        ]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert result[0].visuals[0].type == "mermaid"
        assert result[1].visuals[0].type == "table"
        assert result[2].visuals == []

    def test_returns_same_count_as_input(self):
        sections = [_make_section(f"s{i}") for i in range(5)]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert len(result) == 5

    def test_no_asset_map_still_works(self):
        sections = [_make_section("s1", description="workflow steps")]
        brief = _make_brief()
        result = plan_visuals(sections, None, brief)
        assert result[0].visuals[0].type == "mermaid"
