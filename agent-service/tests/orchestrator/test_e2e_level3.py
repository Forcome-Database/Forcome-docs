import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest


@pytest.mark.asyncio
async def test_level3_full_pipeline():
    """Level 3 should: parse → brief → blueprint → write_all → consistency → finalize."""
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="写一篇关于微服务架构的技术博客",
        thread_id="test-l3-thread",
        workspace_id="ws-test",
        intent_route="document_create",
        page_id="page-l3-test",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.workers.fixer.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import CreationBrief, CreationBlueprint, SectionDraft
        from app.models.blueprint import SectionPlan
        from app.models.review import ReviewReport

        mock_complexity.return_value = {"level": 3, "reasoning": "creation keyword"}
        mock_brief.return_value = CreationBrief(
            audience="技术团队", goal="技术博客", target_length=3000,
            style="专业", tone="友好",
        )
        mock_blueprint.return_value = CreationBlueprint(
            title="微服务架构", total_word_budget=3000,
            sections=[
                SectionPlan(id="s1", title="简介", level=2, word_budget=500),
                SectionPlan(id="s2", title="核心概念", level=2, word_budget=1000),
                SectionPlan(id="s3", title="实践建议", level=2, word_budget=1000),
                SectionPlan(id="s4", title="总结", level=2, word_budget=500),
            ],
        )
        mock_registry.wait_for_response = AsyncMock(return_value={"confirmed": True})
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()

        mock_write.return_value = [
            SectionDraft(section_id="s1", content="简介内容", word_count=500),
            SectionDraft(section_id="s2", content="核心概念内容", word_count=1000),
            SectionDraft(section_id="s3", content="实践建议内容", word_count=1000),
            SectionDraft(section_id="s4", content="总结内容", word_count=500),
        ]
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=85, issues=[])
        mock_autofix.return_value = (mock_write.return_value, 0)
        mock_finalize.return_value = "Full document content"
        mock_draft.save_draft = MagicMock()

        result = await engine.run(request)

    mock_complexity.assert_called_once()
    mock_brief.assert_called_once()
    mock_blueprint.assert_called_once()
    mock_write.assert_called_once()
    mock_finalize.assert_called_once()


@pytest.mark.asyncio
async def test_level3_with_files():
    """Level 3 with files should call parse_assets first."""
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="基于这些资料写一份报告",
        thread_id="test-l3-files",
        workspace_id="ws-test",
        intent_route="document_create",
        files=[
            {"content_b64": "dGVzdA==", "filename": "a.pdf", "mimetype": "application/pdf"},
            {"content_b64": "dGVzdA==", "filename": "b.pdf", "mimetype": "application/pdf"},
        ],
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.engine.parse_assets_tool") as mock_parse, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.workers.fixer.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import AssetMap, CreationBrief, CreationBlueprint, SectionDraft
        from app.models.review import ReviewReport

        mock_complexity.return_value = {"level": 3, "reasoning": "multi file"}
        mock_parse.return_value = AssetMap(source_word_count=5000)
        mock_brief.return_value = CreationBrief(audience="通用", goal="报告", target_length=5000)
        mock_blueprint.return_value = CreationBlueprint(title="Report", total_word_budget=5000)
        mock_registry.wait_for_response = AsyncMock(return_value={"confirmed": True})
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        mock_write.return_value = [SectionDraft(section_id="s1", content="content", word_count=5000)]
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.return_value = (mock_write.return_value, 0)
        mock_finalize.return_value = "content"
        mock_draft.save_draft = MagicMock()

        await engine.run(request)

    mock_parse.assert_called_once()
