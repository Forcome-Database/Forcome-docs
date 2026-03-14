"""Core orchestrator engine using PydanticAI.

The OrchestratorEngine receives a user request, analyzes its complexity,
and dispatches to the appropriate execution path.

Phase 1 implementation: all complexity levels fall back to Level 1
(simple_edit → finalize). Levels 2 and 3 will be added in later phases.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.agent.events import emit
from app.orchestrator.tools.complexity import analyze_task_complexity
from app.orchestrator.tools.finalize import finalize_and_emit
from app.orchestrator.tools.simple_edit import SimpleEditRequest, execute_simple_edit


class OrchestratorRequest(BaseModel):
    """Input model for an orchestrator run."""

    # Core fields
    thread_id: str
    task_id: str = ""
    user_message: str

    # Context
    page_content: str = ""
    selected_text: str = ""
    system_prompt: str = ""
    template_prompt: str = ""
    conversation_history: list[dict] = Field(default_factory=list)

    # Files as minimal metadata dicts ({"name": str, "type": str})
    files: list[dict] = Field(default_factory=list)

    # Routing
    intent_route: Literal[
        "selection_edit", "document_transform", "document_create"
    ] = "document_create"
    template_id: str | None = None
    insert_mode: str = "create"

    # Workspace
    workspace_id: str = ""


class OrchestratorEngine:
    """Orchestrates document creation across complexity Levels 1/2/3.

    Phase 1 routes all requests through Level 1 (simple_edit → finalize).
    """

    async def run(self, request: OrchestratorRequest) -> str:
        """Execute the full orchestration pipeline for a request.

        Args:
            request: Fully populated OrchestratorRequest.

        Returns:
            The final merged content string.

        Raises:
            ValueError: If user_message is empty.
        """
        if not request.user_message.strip():
            raise ValueError("user_message must not be empty")

        # Step 1: Analyze complexity
        await emit(
            request.thread_id,
            {
                "type": "step_start",
                "step": "analyze_complexity",
                "description": "Analyzing task complexity…",
            },
        )

        complexity = analyze_task_complexity(
            user_message=request.user_message,
            files=request.files,
            intent_route=request.intent_route,
            template_id=request.template_id,
            selected_text=request.selected_text,
        )

        await emit(
            request.thread_id,
            {
                "type": "step_done",
                "step": "analyze_complexity",
                "result_summary": (
                    f"Complexity Level {complexity['level']}: "
                    f"{complexity['reasoning']}"
                ),
            },
        )

        # Step 2: Dispatch (Phase 1: all levels use simple_edit)
        level = complexity["level"]

        if level == 1:
            return await self._execute_level1(request)
        elif level == 2:
            # Phase 1 fallback: treat as Level 1
            return await self._execute_level1(request)
        else:
            # Phase 1 fallback: treat as Level 1
            return await self._execute_level1(request)

    async def _execute_level1(self, request: OrchestratorRequest) -> str:
        """Execute a Level 1 (simple edit) task.

        1. Calls execute_simple_edit (LLM streaming).
        2. Calls finalize_and_emit (merge + done event).

        Args:
            request: The orchestrator request.

        Returns:
            The final content string.
        """
        edit_request = SimpleEditRequest(
            thread_id=request.thread_id,
            user_message=request.user_message,
            page_content=request.page_content,
            selected_text=request.selected_text,
            system_prompt=request.system_prompt,
            template_prompt=request.template_prompt,
            conversation_history=request.conversation_history,
        )

        edited_content = await execute_simple_edit(edit_request)

        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=[edited_content],
            insert_mode=request.insert_mode,
        )

        return final_content
