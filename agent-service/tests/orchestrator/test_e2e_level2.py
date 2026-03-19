"""Level 2 end-to-end integration test.

Tests the normal Level 2 pipeline: parse_assets → brief → simple_edit → done.
Uses mocked LLM and tools to verify the flow without external services.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest


@pytest.mark.asyncio
async def test_level2_pipeline_with_file():
    """Level 2 with a file should: parse → brief → simple_edit → finalize."""
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="优化排版",
        thread_id="test-l2-thread",
        workspace_id="ws-test",
        intent_route="document_transform",
        page_id="page-1",
        page_content="原页面内容",
        files=[{
            "content_b64": "dGVzdA==",
            "filename": "test.md",
            "mimetype": "text/markdown",
        }],
    )

    from app.models import AssetMap, CreationBrief

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
         patch("app.orchestrator.engine.execute_simple_edit",
               new_callable=AsyncMock,
               return_value="Formatted content here.") as mock_edit, \
         patch("app.orchestrator.engine.finalize_and_emit",
               new_callable=AsyncMock,
               return_value="Formatted content here.") as mock_finalize, \
         patch.object(engine, "_await_user_input",
               new=AsyncMock(return_value={"brief": CreationBrief(
                   audience="通用", goal="排版优化", target_length=1000,
                   style="专业", tone="正式",
               ).model_dump()})), \
         patch("app.orchestrator.engine.emit", new=AsyncMock()) as mock_emit:

        result = await engine.run(request)

    # Verify parse_assets was called (has files)
    mock_parse.assert_called_once()
    # Verify brief was generated
    mock_brief.assert_called_once()
    # Verify simple edit was used for the normal L2 path
    mock_edit.assert_called_once()
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
        page_id="page-2",
        page_content="当前页面原始内容",
    )

    from app.models import CreationBrief

    with patch("app.orchestrator.engine.analyze_task_complexity",
               return_value={"level": 2, "reasoning": "structured transform"}), \
         patch("app.orchestrator.engine.parse_assets_tool",
               new_callable=AsyncMock,
               return_value=None) as mock_parse, \
         patch("app.orchestrator.engine.generate_brief",
               new_callable=AsyncMock,
               return_value=CreationBrief(audience="通用", goal="排版", target_length=500)) as mock_brief, \
         patch("app.orchestrator.engine.execute_simple_edit",
               new_callable=AsyncMock,
               return_value="Result") as mock_edit, \
         patch("app.orchestrator.engine.finalize_and_emit",
               new_callable=AsyncMock,
               return_value="Result") as mock_finalize, \
         patch.object(engine, "_await_user_input",
               new=AsyncMock(return_value={"brief": CreationBrief(
                   audience="通用", goal="排版", target_length=500
               ).model_dump()})), \
         patch("app.orchestrator.engine.emit", new=AsyncMock()) as mock_emit:

        result = await engine.run(request)

    # parse_assets should NOT be called (no files)
    mock_parse.assert_not_called()
    # brief and simple edit should still be called
    mock_brief.assert_called_once()
    mock_edit.assert_called_once()
    assert isinstance(result, str)


@pytest.mark.asyncio
async def test_level2_single_file_with_source_images_promotes_to_structured_write():
    """Single-file transforms with source images should upgrade to the structured write flow."""
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="重新整理这个SOP并保留原图",
        thread_id="test-l2-promote",
        workspace_id="ws-test",
        intent_route="document_transform",
        page_id="page-3",
        page_content="当前页面原始内容",
        files=[{
            "content_b64": "dGVzdA==",
            "filename": "采购退货单sop.pdf",
            "mimetype": "application/pdf",
        }],
    )

    from app.models import AssetItem, AssetMap, CreationBrief

    with patch("app.orchestrator.engine.analyze_task_complexity",
               return_value={"level": 2, "reasoning": "single file uploaded"}), \
         patch("app.orchestrator.engine.parse_assets_tool",
               new_callable=AsyncMock,
               return_value=AssetMap(items=[
                   AssetItem(id="txt-1", type="text", content="源文档正文"),
                   AssetItem(
                       id="img-1",
                       type="image",
                       source="采购退货单sop.pdf",
                       content="/api/files/source-image.png",
                       summary="[source_image] 原始流程截图",
                   ),
               ], source_word_count=1000)) as mock_parse, \
         patch("app.orchestrator.engine.generate_brief",
               new_callable=AsyncMock,
               return_value=CreationBrief(
                   audience="通用", goal="保留原图并整理排版", target_length=1000,
                   style="专业", tone="正式", image_strategy="reuse_source_only",
               )) as mock_brief, \
         patch.object(engine, "_await_user_input",
               new=AsyncMock(return_value={"brief": CreationBrief(
                   audience="通用", goal="保留原图并整理排版", target_length=1000,
                   style="专业", tone="正式", image_strategy="reuse_source_only",
               ).model_dump()})), \
         patch.object(engine, "_execute_structured_write_from_brief",
               new=AsyncMock(return_value="Structured result")) as mock_structured, \
         patch("app.orchestrator.engine.execute_simple_edit",
               new_callable=AsyncMock,
               return_value="Unexpected simple edit") as mock_edit, \
         patch("app.orchestrator.engine.emit", new=AsyncMock()) as mock_emit:

        result = await engine.run(request)

    mock_parse.assert_called_once()
    mock_brief.assert_called_once()
    mock_structured.assert_called_once()
    mock_edit.assert_not_called()
    assert result == "Structured result"
