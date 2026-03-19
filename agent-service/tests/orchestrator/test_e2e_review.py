import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.orchestrator.tools.evaluate import evaluate_quality
from app.models.draft import SectionDraft
from app.models.blueprint import CreationBlueprint, SectionPlan, VisualPlan
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


@pytest.mark.asyncio
async def test_evaluate_quality_exposes_visual_blocker_when_ai_image_is_not_inserted():
    drafts = [
        SectionDraft(
            section_id="s1",
            content=(
                "This section never inserted the generated image, even though the workflow "
                "already produced one and expected the markdown to embed it in place."
            ),
            word_count=180,
            visuals_generated=["https://cdn.example.com/generated.png"],
        ),
    ]
    blueprint = CreationBlueprint(
        title="Test",
        sections=[
            SectionPlan(
                id="s1",
                title="Intro",
                level=2,
                word_budget=200,
                visuals=[VisualPlan(type="ai_image", description="Architecture image")],
            )
        ],
        total_word_budget=200,
    )
    brief = CreationBrief(target_length=200)

    with patch("app.orchestrator.tools.evaluate.evaluate_with_llm") as mock_llm:
        mock_llm.return_value = (80, [])

        report = await evaluate_quality(
            drafts=drafts,
            blueprint=blueprint,
            brief=brief,
            thread_id="test-review-visual",
        )

    visual_issues = [i for i in report.issues if i.category == "visual"]
    assert len(visual_issues) == 1
    assert report.user_decision_needed == [visual_issues[0].id]


@pytest.mark.asyncio
async def test_evaluate_quality_blocks_generated_fallback_when_policy_is_reuse_only():
    drafts = [
        SectionDraft(
            section_id="s1",
            content="![Architecture image](https://cdn.example.com/generated.png)\n\nBody copy.",
            word_count=180,
            visuals_generated=["https://cdn.example.com/generated.png"],
        ),
    ]
    blueprint = CreationBlueprint(
        title="Test",
        sections=[
            SectionPlan(
                id="s1",
                title="Intro",
                level=2,
                word_budget=200,
                visuals=[
                    VisualPlan(
                        type="ai_image",
                        description="Architecture image",
                        source_asset_id="img-source-1",
                        fallback_reason="source asset unavailable",
                    )
                ],
            )
        ],
        total_word_budget=200,
    )
    brief = CreationBrief(target_length=200, image_strategy="reuse_source_only")

    with patch("app.orchestrator.tools.evaluate.evaluate_with_llm") as mock_llm:
        mock_llm.return_value = (82, [])

        report = await evaluate_quality(
            drafts=drafts,
            blueprint=blueprint,
            brief=brief,
            thread_id="test-review-policy",
        )

    visual_issues = [i for i in report.issues if i.category == "visual"]
    assert len(visual_issues) == 1
    assert visual_issues[0].severity == "error"
    assert report.user_decision_needed == [visual_issues[0].id]
