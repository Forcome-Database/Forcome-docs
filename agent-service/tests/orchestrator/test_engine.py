"""Tests for OrchestratorEngine and OrchestratorRequest.

Note: run() makes LLM calls via execute_simple_edit, so only structural
and validation tests are included here. Full integration tests require mocking.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest


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
    async def test_level2_falls_back_to_level1(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 2, "reasoning": "test"},
            ),
            patch.object(
                engine, "_execute_level1", new=AsyncMock(return_value="formatted content")
            ) as mock_execute,
            patch("app.orchestrator.engine.emit", new=AsyncMock()),
        ):
            req = OrchestratorRequest(thread_id="t", user_message="format this")
            result = await engine.run(req)
            mock_execute.assert_called_once_with(req)
            assert result == "formatted content"

    @pytest.mark.asyncio
    async def test_level3_falls_back_to_level1(self):
        engine = OrchestratorEngine()
        with (
            patch(
                "app.orchestrator.engine.analyze_task_complexity",
                return_value={"level": 3, "reasoning": "test"},
            ),
            patch.object(
                engine, "_execute_level1", new=AsyncMock(return_value="created content")
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
