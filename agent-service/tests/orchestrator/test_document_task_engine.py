from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.orchestrator.document_task_engine import DocumentTaskEngine
from app.orchestrator.engine import OrchestratorRequest


def _request(
    *,
    intent_route: str = "document_transform",
    document_task: dict | None = None,
    files: list[dict] | None = None,
) -> OrchestratorRequest:
    return OrchestratorRequest(
        thread_id="thread-1",
        user_message="Optimize this document",
        intent_route=intent_route,  # type: ignore[arg-type]
        document_task=document_task,
        files=files or [],
    )


def test_selection_rewrite_uses_inline_rewrite_workflow():
    engine = DocumentTaskEngine()

    workflow = engine.resolve_workflow(
        _request(
            intent_route="selection_edit",
            document_task={
                "task_type": "selection_edit",
                "mode": "strict_preservation",
            },
        )
    )

    assert workflow == "inline_rewrite"


def test_strict_document_transform_uses_preservation_patch_workflow():
    engine = DocumentTaskEngine()

    workflow = engine.resolve_workflow(
        _request(
            document_task={
                "task_type": "document_transform",
                "mode": "strict_preservation",
            },
            files=[{"name": "guide.pdf"}],
        )
    )

    assert workflow == "preservation_patch"


def test_relaxed_document_transform_uses_draft_synthesis_workflow():
    engine = DocumentTaskEngine()

    workflow = engine.resolve_workflow(
        _request(
            document_task={
                "task_type": "document_transform",
                "mode": "relaxed_optimization",
            },
            files=[{"name": "guide.pdf"}, {"name": "notes.pdf"}],
        )
    )

    assert workflow == "draft_synthesis"


def test_expert_collaboration_state_does_not_create_a_third_engine_path():
    engine = DocumentTaskEngine()

    workflow = engine.resolve_workflow(
        _request(
            document_task={
                "task_type": "document_transform",
                "mode": "strict_preservation",
                "status": "awaiting_review",
            },
            files=[{"name": "guide.pdf"}],
        )
    )

    assert workflow == "preservation_patch"


@pytest.mark.asyncio
async def test_run_delegates_inline_rewrite_to_level1():
    engine = DocumentTaskEngine()

    with patch.object(
        engine.orchestrator,
        "_execute_level1",
        new=AsyncMock(return_value="inline rewrite"),
    ) as mock_level1:
        result = await engine.run(
            _request(
                intent_route="selection_edit",
                document_task={
                    "task_type": "selection_edit",
                    "mode": "strict_preservation",
                },
            )
        )

    mock_level1.assert_called_once()
    assert result == "inline rewrite"


@pytest.mark.asyncio
async def test_run_delegates_preservation_patch_to_level2():
    engine = DocumentTaskEngine()

    with patch.object(
        engine.orchestrator,
        "_execute_preservation_patch",
        new=AsyncMock(return_value="preservation patch"),
    ) as mock_preservation_patch:
        result = await engine.run(
            _request(
                document_task={
                    "task_type": "document_transform",
                    "mode": "strict_preservation",
                },
                files=[{"name": "guide.pdf"}],
            )
        )

    mock_preservation_patch.assert_called_once()
    assert result == "preservation patch"


@pytest.mark.asyncio
async def test_run_delegates_relaxed_synthesis_to_level3():
    engine = DocumentTaskEngine()

    with (
        patch(
            "app.orchestrator.document_task_engine.analyze_task_complexity",
            return_value={"level": 3, "reasoning": "multi-document synthesis"},
        ),
        patch.object(
            engine.orchestrator,
            "_execute_level3",
            new=AsyncMock(return_value="draft synthesis"),
        ) as mock_level3,
    ):
        result = await engine.run(
            _request(
                document_task={
                    "task_type": "document_transform",
                    "mode": "relaxed_optimization",
                },
                files=[{"name": "guide.pdf"}, {"name": "notes.pdf"}],
            )
        )

    mock_level3.assert_called_once()
    assert result == "draft synthesis"
