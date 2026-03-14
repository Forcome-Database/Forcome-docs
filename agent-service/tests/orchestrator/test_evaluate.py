"""Tests for evaluate_quality orchestrator tool."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.draft import SectionDraft
from app.models.review import ReviewIssue


# ── helpers ──────────────────────────────────────────────────────────────────

def make_section(sid: str = "s1", title: str = "Overview", level: int = 2, word_budget: int = 300, assets: list[str] | None = None) -> SectionPlan:
    return SectionPlan(id=sid, title=title, level=level, word_budget=word_budget, assets=assets or [])


def make_blueprint(*sections: SectionPlan) -> CreationBlueprint:
    return CreationBlueprint(title="Test Doc", sections=list(sections))


def make_draft(section_id: str, word_count: int = 100, assets_used: list[str] | None = None, content: str = "") -> SectionDraft:
    c = content or ("This is well-formed section content. " * 5)
    return SectionDraft(section_id=section_id, content=c, word_count=word_count, assets_used=assets_used or [])


def make_brief() -> CreationBrief:
    return CreationBrief(audience="developers", style="technical", target_length=600)


def make_review_issue(issue_id: str, auto_fixable: bool = False, fixed: bool = False) -> ReviewIssue:
    return ReviewIssue(
        id=issue_id,
        section_id="s1",
        severity="warning",
        category="content",
        description="Test issue",
        suggestion="Fix it",
        auto_fixable=auto_fixable,
        fixed=fixed,
    )


# ── evaluate_quality ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_evaluate_quality_returns_report():
    """Basic smoke test — returns ReviewReport."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", word_budget=300)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", word_count=300)

    det_issues = []
    llm_score = 85
    llm_issues = []

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=det_issues), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(llm_score, llm_issues)):
        report = await evaluate_quality([draft], blueprint, brief)

    assert report.overall_score == 85
    assert report.issues == []
    assert report.auto_fixed_count == 0


@pytest.mark.asyncio
async def test_evaluate_quality_merges_issues():
    """Deterministic + LLM issues are merged into a single list."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", word_budget=300)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", word_count=300)

    det_issue = make_review_issue("det-1", auto_fixable=True)
    llm_issue = make_review_issue("llm-1", auto_fixable=False)

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[det_issue]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(80, [llm_issue])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert len(report.issues) == 2
    issue_ids = {i.id for i in report.issues}
    assert "det-1" in issue_ids
    assert "llm-1" in issue_ids


@pytest.mark.asyncio
async def test_evaluate_quality_length_compliance_exact():
    """Perfect word count match → compliance = 1.0."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", word_budget=300)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", word_count=300)

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(80, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert report.length_compliance == 1.0


@pytest.mark.asyncio
async def test_evaluate_quality_length_compliance_under():
    """150 words vs 300 budget → 50% deviation → compliance = 0.5."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", word_budget=300)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", word_count=150)

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(70, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert abs(report.length_compliance - 0.5) < 0.001


@pytest.mark.asyncio
async def test_evaluate_quality_length_compliance_clamped():
    """Compliance is clamped to [0.0, 1.0]."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", word_budget=100)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", word_count=300)  # 200% deviation

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(70, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert report.length_compliance >= 0.0
    assert report.length_compliance <= 1.0


@pytest.mark.asyncio
async def test_evaluate_quality_no_budget_length_compliance_one():
    """Zero total budget → compliance defaults to 1.0."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", word_budget=0)
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", word_count=500)

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(75, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert report.length_compliance == 1.0


@pytest.mark.asyncio
async def test_evaluate_quality_asset_reuse_rate_all_used():
    """All planned assets used → rate = 1.0."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", assets=["a1", "a2"])
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", assets_used=["a1", "a2"])

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(90, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert report.asset_reuse_rate == 1.0


@pytest.mark.asyncio
async def test_evaluate_quality_asset_reuse_rate_partial():
    """1 of 2 planned assets used → rate = 0.5."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1", assets=["a1", "a2"])
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1", assets_used=["a1"])

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(75, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert abs(report.asset_reuse_rate - 0.5) < 0.001


@pytest.mark.asyncio
async def test_evaluate_quality_user_decision_needed_populated():
    """Non-auto-fixable, non-fixed issues end up in user_decision_needed."""
    from app.orchestrator.tools.evaluate import evaluate_quality

    section = make_section("s1")
    blueprint = make_blueprint(section)
    brief = make_brief()
    draft = make_draft("s1")

    auto_issue = make_review_issue("auto-1", auto_fixable=True)
    manual_issue = make_review_issue("manual-1", auto_fixable=False)
    fixed_issue = make_review_issue("fixed-1", auto_fixable=False, fixed=True)

    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[auto_issue, manual_issue, fixed_issue]), \
         patch("app.orchestrator.tools.evaluate.evaluate_with_llm", new_callable=AsyncMock, return_value=(80, [])):
        report = await evaluate_quality([draft], blueprint, brief)

    assert "manual-1" in report.user_decision_needed
    assert "auto-1" not in report.user_decision_needed
    assert "fixed-1" not in report.user_decision_needed
