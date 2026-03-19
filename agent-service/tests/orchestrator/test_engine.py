"""Tests for OrchestratorEngine and OrchestratorRequest.

Note: run() makes LLM calls via execute_simple_edit, so only structural
and validation tests are included here. Full integration tests require mocking.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.orchestrator.engine import (
    OrchestratorEngine,
    OrchestratorRequest,
    _should_promote_level2_to_structured_write,
)


# ---------------------------------------------------------------------------
# OrchestratorRequest model tests
# ---------------------------------------------------------------------------

class TestOrchestratorRequest:
    def test_minimal_request(self):
        req = OrchestratorRequest(
            thread_id="th-1",
            user_message="translate this text",
        )
        assert req.thread_id == "th-1"
        assert req.user_message == "translate this text"
        assert req.task_id == ""
        assert req.page_content == ""
        assert req.selected_text == ""
        assert req.system_prompt == ""
        assert req.template_prompt == ""
        assert req.conversation_history == []
        assert req.files == []
        assert req.intent_route == "document_create"
        assert req.template_id is None
        assert req.insert_mode == "create"
        assert req.workspace_id == ""

    def test_full_request(self):
        req = OrchestratorRequest(
            thread_id="th-2",
            task_id="task-abc",
            user_message="write a proposal",
            page_content="Existing page content",
            selected_text="Selected portion",
            system_prompt="You are an expert writer.",
            template_prompt="Use formal language.",
            conversation_history=[{"role": "user", "content": "Hi"}],
            files=[{"name": "ref.pdf"}],
            intent_route="document_create",
            template_id="tpl-999",
            insert_mode="replace",
            workspace_id="ws-1",
        )
        assert req.task_id == "task-abc"
        assert req.template_id == "tpl-999"
        assert req.insert_mode == "replace"
        assert len(req.files) == 1

    def test_thread_id_required(self):
        with pytest.raises(Exception):
            OrchestratorRequest(user_message="fix it")  # type: ignore[call-arg]

    def test_user_message_required(self):
        with pytest.raises(Exception):
            OrchestratorRequest(thread_id="th-3")  # type: ignore[call-arg]

    def test_valid_intent_routes(self):
        for intent in ("selection_edit", "document_transform", "document_create"):
            req = OrchestratorRequest(
                thread_id="t",
                user_message="do something",
                intent_route=intent,  # type: ignore[arg-type]
            )
            assert req.intent_route == intent

    def test_invalid_intent_route_rejected(self):
        with pytest.raises(Exception):
            OrchestratorRequest(
                thread_id="t",
                user_message="do something",
                intent_route="unknown_route",  # type: ignore[arg-type]
            )

    def test_is_pydantic_model(self):
        from pydantic import BaseModel

        req = OrchestratorRequest(thread_id="t", user_message="test")
        assert isinstance(req, BaseModel)


# ---------------------------------------------------------------------------
# OrchestratorEngine initialization
# ---------------------------------------------------------------------------

class TestOrchestratorEngineInit:
    def test_engine_can_be_instantiated(self):
        engine = OrchestratorEngine()
        assert engine is not None

    def test_engine_has_run_method(self):
        engine = OrchestratorEngine()
        assert callable(engine.run)

    def test_engine_has_execute_level1_method(self):
        engine = OrchestratorEngine()
        assert callable(engine._execute_level1)

    def test_engine_has_execute_level2_method(self):
        engine = OrchestratorEngine()
        assert callable(engine._execute_level2)


# ---------------------------------------------------------------------------
# Empty message validation
# ---------------------------------------------------------------------------

class TestEngineValidation:
    @pytest.mark.asyncio
    async def test_empty_message_raises_value_error(self):
        engine = OrchestratorEngine()
        req = OrchestratorRequest(thread_id="t", user_message="")
        with pytest.raises(ValueError, match="user_message must not be empty"):
            await engine.run(req)

    @pytest.mark.asyncio
    async def test_whitespace_only_message_raises_value_error(self):
        engine = OrchestratorEngine()
        req = OrchestratorRequest(thread_id="t", user_message="   \t\n  ")
        with pytest.raises(ValueError, match="user_message must not be empty"):
            await engine.run(req)


# ---------------------------------------------------------------------------
# Complexity dispatch (mocked LLM)
# ---------------------------------------------------------------------------

class TestComplexityDispatch:
    """Verify the engine calls analyze_task_complexity and routes to _execute_level1
    for all levels in Phase 1."""

    @pytest.mark.asyncio
    async def test_level1_route_called(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 1, "reasoning": "test"},
            ),
            patch.object(
                engine, "_execute_level1", new=AsyncMock(return_value="edited content")
            ) as mock_execute,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(
                thread_id="t",
                user_message="translate this",
                intent_route="selection_edit",
            )
            result = await engine.run(req)
            mock_execute.assert_called_once_with(req)
            assert result == "edited content"

    @pytest.mark.asyncio
    async def test_level2_routes_to_execute_level2(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 2, "reasoning": "test"},
            ),
            patch.object(
                engine, "_execute_level2", new=AsyncMock(return_value="level2 content")
            ) as mock_execute,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(thread_id="t", user_message="format this")
            result = await engine.run(req)
            mock_execute.assert_called_once_with(req)
            assert result == "level2 content"

    @pytest.mark.asyncio
    async def test_level3_routes_to_execute_level3(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 3, "reasoning": "test"},
            ),
            patch.object(
                engine, "_execute_level3", new=AsyncMock(return_value="created content")
            ) as mock_execute,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(thread_id="t", user_message="write a blog post")
            result = await engine.run(req)
            mock_execute.assert_called_once_with(req)
            assert result == "created content"

    @pytest.mark.asyncio
    async def test_emits_step_start_and_step_done_for_complexity(self):
        engine = OrchestratorEngine()
        emit_calls: list = []

        async def fake_emit(thread_id: str, event: dict) -> None:
            emit_calls.append(event)

        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 1, "reasoning": "selection_edit"},
            ),
            patch.object(
                engine, "_execute_level1", new=AsyncMock(return_value="done")
            ),
            patch("app.orchestrator.engine.emit", side_effect=fake_emit),
        ):
            req = OrchestratorRequest(thread_id="th-emit", user_message="fix this")
            await engine.run(req)

        event_types = [e["type"] for e in emit_calls]
        assert "step_start" in event_types
        assert "step_done" in event_types


# ---------------------------------------------------------------------------
# Level 2 routing and _execute_level2
# ---------------------------------------------------------------------------

class TestLevel2Routing:
    @pytest.mark.asyncio
    async def test_level2_routes_to_execute_level2(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 2, "reasoning": "structured creation"},
            ),
            patch.object(
                engine, "_execute_level2", new=AsyncMock(return_value="l2 content")
            ) as mock_l2,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(
                thread_id="t",
                user_message="create a report from this PDF",
                files=[{"name": "report.pdf", "type": "application/pdf"}],
            )
            result = await engine.run(req)
            mock_l2.assert_called_once_with(req)
            assert result == "l2 content"

    @pytest.mark.asyncio
    async def test_level1_not_called_when_level2(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 2, "reasoning": "test"},
            ),
            patch.object(
                engine, "_execute_level1", new=AsyncMock(return_value="l1 content")
            ) as mock_l1,
            patch.object(
                engine, "_execute_level2", new=AsyncMock(return_value="l2 content")
            ),
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(thread_id="t", user_message="format this")
            await engine.run(req)
            mock_l1.assert_not_called()


class TestExecuteLevel2:
    @pytest.mark.asyncio
    async def test_execute_level2_calls_parse_assets_when_files_present(self):
        engine = OrchestratorEngine()
        from app.models.asset_map import AssetMap
        from app.models.brief import CreationBrief
        from app.models.blueprint import CreationBlueprint

        with (
            patch(
                "app.orchestrator.engine.parse_assets_tool",
                new_callable=AsyncMock,
                return_value=AssetMap(),
            ) as mock_parse,
            patch(
                "app.orchestrator.engine.generate_brief",
                new_callable=AsyncMock,
                return_value=CreationBrief(),
            ),
            patch(
                "app.orchestrator.engine.generate_blueprint",
                new_callable=AsyncMock,
                return_value=CreationBlueprint(),
            ),
            patch(
                "app.orchestrator.engine.execute_simple_edit",
                new_callable=AsyncMock,
                return_value="content",
            ),
            patch(
                "app.orchestrator.engine.finalize_and_emit",
                new_callable=AsyncMock,
                return_value="final content",
            ),
            patch.object(
                engine,
                "_await_user_input",
                new=AsyncMock(return_value={"brief": CreationBrief().model_dump()}),
            ),
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(
                thread_id="t",
                user_message="create a report",
                files=[{"content_b64": "abc", "filename": "doc.pdf", "mimetype": "application/pdf"}],
            )
            result = await engine._execute_level2(req)
            mock_parse.assert_called_once()
            assert result == "final content"

    @pytest.mark.asyncio
    async def test_execute_level2_skips_parse_assets_when_no_files(self):
        engine = OrchestratorEngine()
        from app.models.brief import CreationBrief
        from app.models.blueprint import CreationBlueprint

        with (
            patch(
                "app.orchestrator.engine.parse_assets_tool",
                new_callable=AsyncMock,
                return_value=None,
            ) as mock_parse,
            patch(
                "app.orchestrator.engine.generate_brief",
                new_callable=AsyncMock,
                return_value=CreationBrief(),
            ),
            patch(
                "app.orchestrator.engine.generate_blueprint",
                new_callable=AsyncMock,
                return_value=CreationBlueprint(),
            ),
            patch(
                "app.orchestrator.engine.execute_simple_edit",
                new_callable=AsyncMock,
                return_value="content",
            ),
            patch(
                "app.orchestrator.engine.finalize_and_emit",
                new_callable=AsyncMock,
                return_value="final",
            ),
            patch.object(
                engine,
                "_await_user_input",
                new=AsyncMock(return_value={"brief": CreationBrief().model_dump()}),
            ),
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(
                thread_id="t",
                user_message="create something",
                files=[],  # no files
            )
            await engine._execute_level2(req)
            mock_parse.assert_not_called()

    def test_promotes_level2_to_structured_write_for_source_images(self):
        from app.models.asset_map import AssetItem, AssetMap
        from app.models.brief import CreationBrief

        request = OrchestratorRequest(
            thread_id="t",
            user_message="重新整理这个SOP并保留原图",
            intent_route="document_transform",
            files=[{"content_b64": "abc", "filename": "doc.pdf", "mimetype": "application/pdf"}],
        )
        asset_map = AssetMap(
            items=[
                AssetItem(id="txt-1", type="text", content="步骤说明"),
                AssetItem(
                    id="img-1",
                    type="image",
                    source="doc.pdf",
                    content="/api/files/img-1/source.png",
                    summary="[source_image] 原始流程截图",
                ),
            ]
        )
        brief = CreationBrief(
            goal="整理排版",
            target_length=500,
            image_strategy="reuse_source_only",
        )

        assert _should_promote_level2_to_structured_write(
            request=request,
            asset_map=asset_map,
            brief=brief,
        ) is True

    @pytest.mark.asyncio
    async def test_execute_level2_upgrades_to_structured_write_when_source_images_must_be_preserved(self):
        engine = OrchestratorEngine()
        from app.models.asset_map import AssetItem, AssetMap
        from app.models.brief import CreationBrief
        from app.models.blueprint import CreationBlueprint, SectionPlan
        from app.models.document_tree import DocumentNode, DocumentTree
        from app.models.draft import SectionDraft
        from app.models.review import ReviewReport

        brief = CreationBrief(
            goal="整理排版",
            target_length=500,
            image_strategy="reuse_source_only",
        )
        blueprint = CreationBlueprint(
            title="采购退货单 SOP",
            total_word_budget=500,
            sections=[SectionPlan(id="s1", title="处理前提", level=2, word_budget=500)],
        )
        drafts = [
            SectionDraft(
                section_id="s1",
                content="![原图](/api/files/img-1/source.png)\n\n整理后的正文",
                word_count=120,
                image_status="source_reused",
                source_image_asset_id="img-1",
            )
        ]

        with (
            patch(
                "app.orchestrator.engine.parse_assets_tool",
                new_callable=AsyncMock,
                return_value=AssetMap(
                    items=[
                        AssetItem(id="txt-1", type="text", content="原文说明"),
                        AssetItem(
                            id="img-1",
                            type="image",
                            source="doc.pdf",
                            content="/api/files/img-1/source.png",
                            summary="[source_image] 原始流程截图",
                        ),
                    ],
                    source_word_count=800,
                ),
            ) as mock_parse,
            patch(
                "app.orchestrator.engine.generate_brief",
                new_callable=AsyncMock,
                return_value=brief,
            ) as mock_brief,
            patch.object(
                engine,
                "_await_user_input",
                new=AsyncMock(return_value={"brief": brief.model_dump()}),
            ),
            patch(
                "app.orchestrator.engine.generate_blueprint",
                new_callable=AsyncMock,
                return_value=blueprint,
            ) as mock_blueprint,
            patch.object(
                engine,
                "_confirm_blueprint",
                new=AsyncMock(return_value=blueprint),
            ),
            patch(
                "app.orchestrator.engine.write_all_sections",
                new_callable=AsyncMock,
                return_value=drafts,
            ) as mock_write,
            patch.object(engine, "_emit_draft_preview", new=AsyncMock()),
            patch.object(
                engine,
                "_build_review_report",
                new=AsyncMock(return_value=(ReviewReport(overall_score=95, issues=[]), drafts)),
            ),
            patch("app.orchestrator.engine.run_consistency_checks", return_value=[]),
            patch("app.orchestrator.engine.draft_store") as mock_draft_store,
            patch(
                "app.orchestrator.engine.build_document_tree",
                return_value=DocumentTree(
                    root=DocumentNode(node_id="document:title", title="采购退货单 SOP", level=1),
                    sections=[
                        DocumentNode(
                            node_id="section:s1",
                            section_id="s1",
                            title="处理前提",
                            level=2,
                            content=drafts[0].content,
                        )
                    ],
                ),
            ),
            patch(
                "app.orchestrator.engine.document_tree_to_sections",
                return_value=[{"content": drafts[0].content}],
            ),
            patch(
                "app.orchestrator.engine.finalize_and_emit",
                new_callable=AsyncMock,
                return_value=drafts[0].content,
            ) as mock_finalize,
            patch(
                "app.orchestrator.engine.execute_simple_edit",
                new_callable=AsyncMock,
                return_value="plain text only",
            ) as mock_simple_edit,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(
                thread_id="t",
                user_message="重新整理这个SOP并保留原图",
                intent_route="document_transform",
                page_id="page-1",
                files=[{"content_b64": "abc", "filename": "doc.pdf", "mimetype": "application/pdf"}],
            )

            result = await engine._execute_level2(req)

        mock_parse.assert_called_once()
        mock_brief.assert_called_once()
        mock_blueprint.assert_called_once()
        mock_write.assert_called_once()
        mock_simple_edit.assert_not_called()
        mock_finalize.assert_called_once()
        mock_draft_store.save_draft.assert_called_once()
        assert result == drafts[0].content

    @pytest.mark.asyncio
    async def test_execute_level2_requests_brief_confirmation_before_simple_edit(self):
        engine = OrchestratorEngine()
        from app.models.brief import CreationBrief

        with (
            patch(
                "app.orchestrator.engine.generate_brief",
                new_callable=AsyncMock,
                return_value=CreationBrief(audience="engineers"),
            ),
            patch(
                "app.orchestrator.engine.execute_simple_edit",
                new_callable=AsyncMock,
                return_value="content",
            ),
            patch(
                "app.orchestrator.engine.finalize_and_emit",
                new_callable=AsyncMock,
                return_value="final",
            ),
            patch.object(
                engine,
                "_await_user_input",
                new=AsyncMock(return_value={"brief": CreationBrief(audience="engineers").model_dump()}),
            ) as mock_await_input,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(
                thread_id="t-ask",
                user_message="create a report",
            )
            await engine._execute_level2(req)

        mock_await_input.assert_called_once()
        assert mock_await_input.await_args.kwargs["phase"] == "brief"

    @pytest.mark.asyncio
    async def test_execute_level2_returns_string(self):
        engine = OrchestratorEngine()
        from app.models.brief import CreationBrief
        from app.models.blueprint import CreationBlueprint

        with (
            patch(
                "app.orchestrator.engine.generate_brief",
                new_callable=AsyncMock,
                return_value=CreationBrief(),
            ),
            patch(
                "app.orchestrator.engine.generate_blueprint",
                new_callable=AsyncMock,
                return_value=CreationBlueprint(),
            ),
            patch(
                "app.orchestrator.engine.execute_simple_edit",
                new_callable=AsyncMock,
                return_value="written content",
            ),
            patch(
                "app.orchestrator.engine.finalize_and_emit",
                new_callable=AsyncMock,
                return_value="final document",
            ),
            patch.object(
                engine,
                "_await_user_input",
                new=AsyncMock(return_value={"brief": CreationBrief().model_dump()}),
            ),
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(thread_id="t", user_message="create a report")
            result = await engine._execute_level2(req)

        assert isinstance(result, str)
        assert result == "final document"
