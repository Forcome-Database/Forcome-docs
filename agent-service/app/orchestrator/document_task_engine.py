from __future__ import annotations

from typing import Literal

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest
from app.orchestrator.tools.complexity import analyze_task_complexity
from app.orchestrator.tools.create_blueprint import (
    requires_outline_confirmation_for_blank_page,
)
from app.orchestrator.tools.create_brief import (
    is_small_blank_page_draft_request,
)
from app.orchestrator.tools.user_interaction import (
    build_synthesis_conflict_review,
)

DocumentTaskWorkflow = Literal[
    "inline_rewrite",
    "preservation_patch",
    "draft_synthesis",
]


class DocumentTaskEngine:
    """Public task-first routing layer for AI document work."""

    def __init__(self, orchestrator: OrchestratorEngine | None = None):
        self.orchestrator = orchestrator or OrchestratorEngine()

    def resolve_workflow(self, request: OrchestratorRequest) -> DocumentTaskWorkflow:
        task_type = (
            request.document_task.task_type
            if request.document_task
            else request.intent_route
        )
        task_mode = (
            request.document_task.mode
            if request.document_task
            else "strict_preservation"
        )

        if task_type == "selection_edit" or request.intent_route == "selection_edit":
            return "inline_rewrite"

        if task_type == "document_transform" and task_mode == "strict_preservation":
            return "preservation_patch"

        return "draft_synthesis"

    async def _resolve_multi_document_conflicts(
        self,
        request: OrchestratorRequest,
    ) -> None:
        conflicts = detect_synthesis_conflicts(request)
        if not conflicts:
            return

        await self.orchestrator._await_user_input(
            thread_id=request.thread_id,
            phase="review",
            data=build_synthesis_conflict_review(conflicts),
            timeout_message="Timed out waiting for synthesis conflict resolution.",
        )

    async def run(self, request: OrchestratorRequest) -> str:
        workflow = self.resolve_workflow(request)

        if workflow == "inline_rewrite":
            return await self.orchestrator._execute_level1(request)

        if workflow == "preservation_patch":
            return await self.orchestrator._execute_preservation_patch(request)

        if len(request.files) >= 2:
            await self._resolve_multi_document_conflicts(request)
            return await self.orchestrator._execute_level3(request)

        if (
            request.intent_route == "document_create"
            and not request.files
            and not (request.page_content or "").strip()
        ):
            if is_small_blank_page_draft_request(
                request.user_message,
                has_files=False,
                page_content=request.page_content,
            ):
                return await self.orchestrator._execute_level1(request)

            if requires_outline_confirmation_for_blank_page(
                request.user_message,
                has_files=False,
                page_content=request.page_content,
            ):
                return await self.orchestrator._execute_level3(request)

        complexity = analyze_task_complexity(
            user_message=request.user_message,
            files=request.files,
            intent_route=request.intent_route,
            template_id=request.template_id,
            selected_text=request.selected_text,
        )

        if complexity["level"] <= 2:
            return await self.orchestrator._execute_level2(request)

        return await self.orchestrator._execute_level3(request)


def detect_synthesis_conflicts(request: OrchestratorRequest) -> list[dict[str, str]]:
    if len(request.files) < 2:
        return []

    normalized = request.user_message.lower()
    conflict_markers = ("conflict", "contradict", "disagree", "difference")
    if any(marker in normalized for marker in conflict_markers):
        return [
            {
                "conflict_id": "source-conflict",
                "title": "Source disagreement detected",
                "details": "The request indicates that the uploaded sources may disagree.",
            }
        ]

    return []
