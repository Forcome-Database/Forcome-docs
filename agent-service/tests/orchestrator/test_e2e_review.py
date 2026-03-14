import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.orchestrator.tools.evaluate import evaluate_quality
from app.models.draft import SectionDraft
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief


@pytest.mark.asyncio
async def test_evaluate_quality_produces_report():
    """evaluate_quality should produce a ReviewReport with deterministic + LLM issues."""
    drafts = [
        SectionDraft(section_id="s1", content="Short", word_count=1),
    ]
    blueprint = CreationBlueprint(
        title="Test",
        sections=[SectionPlan(id="s1", title="Intro", level=2, word_budget=500)],
        total_word_budget=500,
    )
    brief = CreationBrief(target_length=500)

    with patch("app.orchestrator.tools.evaluate.evaluate_with_llm") as mock_llm:
        mock_llm.return_value = (75, [])

        report = await evaluate_quality(
            drafts=drafts,
            blueprint=blueprint,
            brief=brief,
            thread_id="test-review",
        )

    assert report.overall_score == 75
    # Should detect short section
    length_issues = [i for i in report.issues if i.category == "length"]
    assert len(length_issues) >= 1
    # Should detect empty section
    structure_issues = [i for i in report.issues if i.category == "structure"]
    assert len(structure_issues) >= 1
