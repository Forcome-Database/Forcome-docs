"""Level 2 end-to-end integration test.

Tests the full Level 2 pipeline: parse_assets → brief → blueprint → write → done.
Uses mocked LLM and tools to verify the flow without external services.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest


@pytest.mark.asyncio
async def test_level2_pipeline_with_file():
    """Level 2 with a file should: parse → brief → blueprint → write → finalize."""
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="优化排版",
        thread_id="test-l2-thread",
        workspace_id="ws-test",
        intent_route="document_transform",
        files=[{
            "content_b64": "dGVzdA==",
            "filename": "test.md",
            "mimetype": "text/markdown",
        }],
    )

    from app.models import AssetMap, CreationBrief, CreationBlueprint

    with patch("app.orchestrator.engine.analyze_task_complexity",
               return_value={"level": 2, "reasoning": "structured transform"}), \
         patch("app.orchestrator.engine.parse_assets_tool",
               new_callable=AsyncMock,
               return_value=AssetMap(source_word_count=1000)) as mock_parse, \
         patch("app.orchestrator.engine.generate_brief",
               new_callable=AsyncMock,
               return_value=CreationBrief(
                   audience="通用", goal="排版优化", target_length=1000,
                   style="专业", tone="正式",
               )) as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint",
               new_callable=AsyncMock,
               return_value=CreationBlueprint(
                   title="Test", total_word_budget=1000,
               )) as mock_blueprint, \
         patch("app.orchestrator.engine.execute_simple_edit",
               new_callable=AsyncMock,
               return_value="Formatted content here.") as mock_edit, \
         patch("app.orchestrator.engine.finalize_and_emit",
               new_callable=AsyncMock,
               return_value="Formatted content here.") as mock_finalize, \
         patch("app.orchestrator.engine.emit", new=AsyncMock()) as mock_emit:

        result = await engine.run(request)

    # Verify parse_assets was called (has files)
    mock_parse.assert_called_once()
    # Verify brief was generated
    mock_brief.assert_called_once()
    # Verify blueprint was generated
    mock_blueprint.assert_called_once()
    # Verify result is a string
    assert isinstance(result, str)


@pytest.mark.asyncio
async def test_level2_without_files_skips_parse():
    """Level 2 without files should skip parse_assets."""
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="排版这篇文章",
        thread_id="test-l2-no-file",
        workspace_id="ws-test",
        intent_route="document_transform",
    )

    from app.models import CreationBrief, CreationBlueprint

    with patch("app.orchestrator.engine.analyze_task_complexity",
               return_value={"level": 2, "reasoning": "structured transform"}), \
         patch("app.orchestrator.engine.parse_assets_tool",
               new_callable=AsyncMock,
               return_value=None) as mock_parse, \
         patch("app.orchestrator.engine.generate_brief",
               new_callable=AsyncMock,
               return_value=CreationBrief(audience="通用", goal="排版", target_length=500)) as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint",
               new_callable=AsyncMock,
               return_value=CreationBlueprint(title="Test")) as mock_blueprint, \
         patch("app.orchestrator.engine.execute_simple_edit",
               new_callable=AsyncMock,
               return_value="Result") as mock_edit, \
         patch("app.orchestrator.engine.finalize_and_emit",
               new_callable=AsyncMock,
               return_value="Result") as mock_finalize, \
         patch("app.orchestrator.engine.emit", new=AsyncMock()) as mock_emit:

        result = await engine.run(request)

    # parse_assets should NOT be called (no files)
    mock_parse.assert_not_called()
    # brief and blueprint should still be called
    mock_brief.assert_called_once()
    mock_blueprint.assert_called_once()
    assert isinstance(result, str)
