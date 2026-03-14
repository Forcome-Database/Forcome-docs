"""Tests for Evaluator Worker — deterministic checks + LLM evaluation."""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.draft import SectionDraft
from app.models.review import ReviewIssue
from app.workers.evaluator import (
    check_asset_coverage,
    check_empty_sections,
    check_heading_levels,
    check_image_urls,
    check_mermaid_syntax,
    check_word_budgets,
    evaluate_deterministic,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def make_section(sid: str = "s1", title: str = "Overview", level: int = 2, word_budget: int = 300, assets: list[str] | None = None) -> SectionPlan:
    return SectionPlan(id=sid, title=title, level=level, word_budget=word_budget, assets=assets or [])


def make_blueprint(*sections: SectionPlan, title: str = "Test Doc") -> CreationBlueprint:
    return CreationBlueprint(title=title, sections=list(sections))


def make_draft(section_id: str = "s1", content: str = "x" * 100, word_count: int = 0, assets_used: list[str] | None = None) -> SectionDraft:
    return SectionDraft(section_id=section_id, content=content, word_count=word_count, assets_used=assets_used or [])


def make_brief(length_tolerance: float = 0.1, target_length: int = 1000) -> CreationBrief:
    return CreationBrief(audience="developers", style="technical", target_length=target_length, length_tolerance=length_tolerance)


# ── check_word_budgets ────────────────────────────────────────────────────────

def test_word_budget_within_tolerance():
    blueprint = make_blueprint(make_section("s1", word_budget=300))
    draft = make_draft("s1", word_count=300)
    issues = check_word_budgets([draft], blueprint, tolerance=0.1)
    assert issues == []


def test_word_budget_under_tolerance_flagged():
    blueprint = make_blueprint(make_section("s1", word_budget=300))
    # 200/300 = 0.67 < 0.9 threshold
    draft = make_draft("s1", word_count=200)
    issues = check_word_budgets([draft], blueprint, tolerance=0.1)
    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert issues[0].category == "length"
    assert issues[0].section_id == "s1"
    assert "不足" in issues[0].description


def test_word_budget_over_tolerance_flagged():
    blueprint = make_blueprint(make_section("s1", word_budget=300))
    # 400/300 = 1.33 > 1.1 threshold
    draft = make_draft("s1", word_count=400)
    issues = check_word_budgets([draft], blueprint, tolerance=0.1)
    assert len(issues) == 1
    assert issues[0].severity == "info"
    assert "超出" in issues[0].description


def test_word_budget_zero_budget_skipped():
    blueprint = make_blueprint(make_section("s1", word_budget=0))
    draft = make_draft("s1", word_count=500)
    issues = check_word_budgets([draft], blueprint, tolerance=0.1)
    assert issues == []


def test_word_budget_uses_content_when_word_count_zero():
    """When draft.word_count == 0, content is counted directly."""
    blueprint = make_blueprint(make_section("s1", word_budget=300))
    # "hello world " * 50 = 100 words => below 300 budget
    draft = make_draft("s1", content="hello world " * 50, word_count=0)
    issues = check_word_budgets([draft], blueprint, tolerance=0.1)
    assert len(issues) == 1
    assert "不足" in issues[0].description


def test_word_budget_auto_fixable_false():
    blueprint = make_blueprint(make_section("s1", word_budget=300))
    draft = make_draft("s1", word_count=50)
    issues = check_word_budgets([draft], blueprint, tolerance=0.1)
    assert issues[0].auto_fixable is False


# ── check_asset_coverage ──────────────────────────────────────────────────────

def test_asset_coverage_no_asset_map():
    blueprint = make_blueprint(make_section("s1", assets=["a1"]))
    draft = make_draft("s1")
    issues = check_asset_coverage([draft], blueprint, None)
    assert issues == []


def test_asset_coverage_all_used():
    section = make_section("s1", assets=["a1"])
    blueprint = make_blueprint(section)
    asset_map = AssetMap(items=[AssetItem(id="a1", type="image", summary="Photo")])
    draft = make_draft("s1", assets_used=["a1"])
    issues = check_asset_coverage([draft], blueprint, asset_map)
    assert issues == []


def test_asset_coverage_unused_flagged():
    section = make_section("s1", assets=["a1"])
    blueprint = make_blueprint(section)
    asset_map = AssetMap(items=[AssetItem(id="a1", type="image", summary="Important chart")])
    draft = make_draft("s1", assets_used=[])
    issues = check_asset_coverage([draft], blueprint, asset_map)
    assert len(issues) == 1
    assert issues[0].category == "asset"
    assert "a1" in issues[0].description


def test_asset_coverage_planned_but_not_in_map_not_flagged():
    """Assets planned but not in asset_map (don't exist) should not be flagged."""
    section = make_section("s1", assets=["ghost"])
    blueprint = make_blueprint(section)
    asset_map = AssetMap(items=[AssetItem(id="real", type="text", summary="Real asset")])
    draft = make_draft("s1", assets_used=[])
    issues = check_asset_coverage([draft], blueprint, asset_map)
    assert issues == []


# ── check_heading_levels ──────────────────────────────────────────────────────

def test_heading_levels_h1_in_h2_section_flagged():
    section = make_section("s1", level=2)
    blueprint = make_blueprint(section)
    draft = make_draft("s1", content="# Top Level\n\nSome content here.")
    issues = check_heading_levels([draft], blueprint)
    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert issues[0].category == "format"
    assert issues[0].auto_fixable is True
    assert "H1" in issues[0].description
    assert "H2" in issues[0].description


def test_heading_levels_same_level_flagged():
    section = make_section("s1", level=2)
    blueprint = make_blueprint(section)
    draft = make_draft("s1", content="## Same Level\n\nContent")
    issues = check_heading_levels([draft], blueprint)
    assert len(issues) == 1


def test_heading_levels_deeper_ok():
    section = make_section("s1", level=2)
    blueprint = make_blueprint(section)
    draft = make_draft("s1", content="### Sub heading\n\nContent")
    issues = check_heading_levels([draft], blueprint)
    assert issues == []


def test_heading_levels_no_headings_ok():
    section = make_section("s1", level=2)
    blueprint = make_blueprint(section)
    draft = make_draft("s1", content="Plain prose with no headings at all.")
    issues = check_heading_levels([draft], blueprint)
    assert issues == []


def test_heading_levels_only_first_violation_per_section():
    """Only one issue per section even if multiple bad headings."""
    section = make_section("s1", level=2)
    blueprint = make_blueprint(section)
    draft = make_draft("s1", content="# H1\n\n# Another H1\n\nContent")
    issues = check_heading_levels([draft], blueprint)
    assert len(issues) == 1  # breaks after first


# ── check_mermaid_syntax ──────────────────────────────────────────────────────

def test_mermaid_empty_block_flagged():
    draft = make_draft("s1", content="```mermaid\n```")
    issues = check_mermaid_syntax([draft])
    assert len(issues) == 1
    assert issues[0].severity == "error"
    assert issues[0].auto_fixable is True
    assert "空" in issues[0].description


def test_mermaid_no_type_declaration_flagged():
    draft = make_draft("s1", content="```mermaid\nA --> B\n```")
    issues = check_mermaid_syntax([draft])
    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert issues[0].auto_fixable is False


def test_mermaid_valid_graph():
    draft = make_draft("s1", content="```mermaid\ngraph TD\n  A --> B\n```")
    issues = check_mermaid_syntax([draft])
    assert issues == []


def test_mermaid_valid_flowchart():
    draft = make_draft("s1", content="```mermaid\nflowchart LR\n  A --> B\n```")
    issues = check_mermaid_syntax([draft])
    assert issues == []


def test_mermaid_no_blocks_no_issues():
    draft = make_draft("s1", content="Just regular content with no mermaid blocks.")
    issues = check_mermaid_syntax([draft])
    assert issues == []


# ── check_image_urls ──────────────────────────────────────────────────────────

def test_image_url_valid_https_ok():
    draft = make_draft("s1", content="![photo](https://example.com/photo.png)")
    issues = check_image_urls([draft])
    assert issues == []


def test_image_url_relative_path_flagged():
    draft = make_draft("s1", content="![photo](./images/photo.png)")
    issues = check_image_urls([draft])
    assert len(issues) == 1
    assert issues[0].severity == "error"
    assert issues[0].category == "visual"
    assert issues[0].auto_fixable is True
    assert "无效" in issues[0].description


def test_image_url_placeholder_flagged():
    draft = make_draft("s1", content="![photo](https://placehold.co/400x300)")
    issues = check_image_urls([draft])
    assert len(issues) == 1
    assert "占位符" in issues[0].description
    assert issues[0].auto_fixable is True


def test_image_url_dummyimage_flagged():
    draft = make_draft("s1", content="![chart](https://dummyimage.com/600x400/000/fff)")
    issues = check_image_urls([draft])
    assert len(issues) == 1
    assert "占位符" in issues[0].description


def test_image_url_no_images_no_issues():
    draft = make_draft("s1", content="No images here, just text.")
    issues = check_image_urls([draft])
    assert issues == []


# ── check_empty_sections ──────────────────────────────────────────────────────

def test_empty_section_flagged():
    draft = make_draft("s1", content="")
    issues = check_empty_sections([draft])
    assert len(issues) == 1
    assert issues[0].severity == "error"
    assert issues[0].category == "structure"
    assert issues[0].auto_fixable is False


def test_short_section_flagged():
    draft = make_draft("s1", content="Too short.")
    issues = check_empty_sections([draft])
    assert len(issues) == 1


def test_sufficient_section_ok():
    draft = make_draft("s1", content="A" * 60)
    issues = check_empty_sections([draft])
    assert issues == []


def test_whitespace_only_section_flagged():
    draft = make_draft("s1", content="   \n   \n   ")
    issues = check_empty_sections([draft])
    assert len(issues) == 1


# ── evaluate_deterministic ────────────────────────────────────────────────────

def test_evaluate_deterministic_combines_all():
    """All checks are run and results merged."""
    section = make_section("s1", level=2, word_budget=300)
    blueprint = make_blueprint(section)
    brief = make_brief()
    # H1 in H2 section + short content (< 50 chars)
    draft = make_draft("s1", content="# Bad heading\n" + "x" * 20, word_count=5)
    issues = evaluate_deterministic([draft], blueprint, brief)
    categories = {i.category for i in issues}
    assert "format" in categories   # heading level
    assert "length" in categories   # word budget
    assert "structure" in categories  # empty section


def test_evaluate_deterministic_clean_doc_no_issues():
    """A well-formed doc with no issues passes all checks."""
    section = make_section("s1", level=2, word_budget=100)
    blueprint = make_blueprint(section)
    brief = make_brief()
    content = "This is well-formed section content. " * 10  # ~70 words
    draft = make_draft("s1", content=content, word_count=100)
    issues = evaluate_deterministic([draft], blueprint, brief)
    # No heading, mermaid, image, or asset issues
    categories = {i.category for i in issues}
    assert "format" not in categories
    assert "visual" not in categories
    assert "structure" not in categories


# ── evaluate_with_llm ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_evaluate_with_llm_parses_valid_json():
    """LLM returns valid JSON → parsed correctly."""
    from app.workers.evaluator import evaluate_with_llm

    llm_response = json.dumps({
        "overall_score": 85,
        "issues": [
            {
                "section_title": "Intro",
                "severity": "warning",
                "category": "content",
                "description": "Missing examples",
                "suggestion": "Add concrete examples",
            }
        ]
    })

    mock_result = MagicMock()
    mock_result.data = llm_response

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    section = make_section("s1", word_budget=300)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", content="Some content")

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", new_callable=AsyncMock):
        score, issues = await evaluate_with_llm([draft], blueprint, brief, "t1")

    assert score == 85
    assert len(issues) == 1
    assert issues[0].severity == "warning"
    assert issues[0].category == "content"
    assert "Missing examples" in issues[0].description


@pytest.mark.asyncio
async def test_evaluate_with_llm_fallback_on_bad_json():
    """LLM returns invalid JSON → fallback score 70, no issues."""
    from app.workers.evaluator import evaluate_with_llm

    mock_result = MagicMock()
    mock_result.data = "This is not JSON at all"

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    section = make_section("s1")
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1")

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", new_callable=AsyncMock):
        score, issues = await evaluate_with_llm([draft], blueprint, brief)

    assert score == 70
    assert issues == []


@pytest.mark.asyncio
async def test_evaluate_with_llm_fallback_on_missing_fields():
    """LLM returns JSON without required fields → defaults applied."""
    from app.workers.evaluator import evaluate_with_llm

    mock_result = MagicMock()
    mock_result.data = "{}"  # valid JSON but empty

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    section = make_section("s1")
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1")

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", new_callable=AsyncMock):
        score, issues = await evaluate_with_llm([draft], blueprint, brief)

    assert score == 70
    assert issues == []


@pytest.mark.asyncio
async def test_evaluate_with_llm_emits_step_events():
    """Emits step_start and step_done events."""
    from app.workers.evaluator import evaluate_with_llm

    mock_result = MagicMock()
    mock_result.data = '{"overall_score": 80, "issues": []}'

    mock_agent = MagicMock()
    mock_agent.run = AsyncMock(return_value=mock_result)

    section = make_section("s1")
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1")

    emit_calls = []

    async def fake_emit(tid, event):
        emit_calls.append(event)

    with patch("app.orchestrator.llm_factory.create_pydantic_ai_model"), \
         patch("pydantic_ai.Agent", return_value=mock_agent), \
         patch("app.agent.events.emit", side_effect=fake_emit):
        await evaluate_with_llm([draft], blueprint, brief, "thread-1")

    types = [e["type"] for e in emit_calls]
    assert "step_start" in types
    assert "step_done" in types
