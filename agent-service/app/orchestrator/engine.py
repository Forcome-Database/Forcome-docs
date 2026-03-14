"""Core orchestrator engine using PydanticAI.

The OrchestratorEngine receives a user request, analyzes its complexity,
and dispatches to the appropriate execution path.

Phase 1 implementation: Level 1 uses simple_edit → finalize.
Phase 2 implementation: Level 2 uses parse_assets → generate_brief →
    ask_user(brief) → generate_blueprint → ask_user(blueprint) → simple_edit → finalize.
Level 3 falls back to Level 1 pending Phase 3.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.agent.events import emit
from app.orchestrator.tools.complexity import analyze_task_complexity
from app.orchestrator.tools.finalize import finalize_and_emit
from app.orchestrator.tools.simple_edit import SimpleEditRequest, execute_simple_edit

# Phase 2 tools
from app.orchestrator.tools.parse_assets import parse_assets_tool
from app.orchestrator.tools.create_brief import generate_brief
from app.orchestrator.tools.create_blueprint import generate_blueprint
from app.orchestrator.tools.research import research_tool
from app.orchestrator.tools.user_interaction import interaction_registry

# Phase 3 tools
from app.orchestrator.tools.write_tools import write_all_sections
from app.workers.consistency_checker import run_consistency_checks
from app.orchestrator.draft_manager import draft_store
from app.models.brief import CreationBrief
from app.models.blueprint import CreationBlueprint


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
    page_id: str | None = None


class OrchestratorEngine:
    """Orchestrates document creation across complexity Levels 1/2/3.

    Phase 1: Level 1 → simple_edit → finalize.
    Phase 2: Level 2 → parse_assets → generate_brief → ask_user(brief)
                        → generate_blueprint → ask_user(blueprint)
                        → simple_edit (placeholder for section writer) → finalize.
    Level 3: falls back to Level 1 (Phase 3 will add full write/review loop).
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

        # Step 2: Dispatch based on complexity level
        level = complexity["level"]

        if level == 1:
            return await self._execute_level1(request)
        elif level == 2:
            return await self._execute_level2(request)
        elif level == 3:
            return await self._execute_level3(request)
        else:
            # Default to Level 1 for unknown complexity levels
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

    async def _execute_level2(self, request: OrchestratorRequest) -> str:
        """Execute a Level 2 (structured creation) task.

        Phase 2 pipeline:
        1. parse_assets — parse uploaded files into AssetMap (if files present).
        2. generate_brief — LLM analysis → Smart Brief.
        3. ask_user(phase="brief") — emit brief for user confirmation.
        4. generate_blueprint — LLM planning → CreationBlueprint.
        5. ask_user(phase="blueprint") — emit blueprint for user confirmation.
        6. simple_edit — placeholder writer (Phase 3 will add section writer).
        7. finalize — merge + done event.

        Args:
            request: The orchestrator request.

        Returns:
            The final content string.
        """
        # Step 1: Parse assets if files are present
        asset_map = None
        if request.files:
            asset_map = await parse_assets_tool(
                files=request.files,
            )

        # Step 2: Generate Smart Brief
        brief = await generate_brief(
            user_message=request.user_message,
            asset_map=asset_map,
            page_content=request.page_content or None,
            template_prompt=request.template_prompt or None,
            thread_id=request.thread_id,
        )

        # Step 3: Emit ask_user event for brief confirmation
        await emit(
            request.thread_id,
            {
                "type": "ask_user",
                "phase": "brief",
                "brief": brief.model_dump(),
            },
        )

        # Step 4: Generate Blueprint
        blueprint = await generate_blueprint(
            user_message=request.user_message,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
        )

        # Step 5: Emit ask_user event for blueprint confirmation
        await emit(
            request.thread_id,
            {
                "type": "ask_user",
                "phase": "blueprint",
                "blueprint": blueprint.model_dump(),
            },
        )

        # Step 6: Placeholder writer — use simple_edit for now
        # Phase 3 will replace this with per-section SectionWriter calls
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

        # Step 7: Finalize
        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=[edited_content],
            insert_mode=request.insert_mode,
        )

        return final_content

    async def _execute_level3(self, request: OrchestratorRequest) -> str:
        """Execute a Level 3 full creation task.

        Phase 3 pipeline:
        1. parse_assets — parse uploaded files into AssetMap (if files present).
        2. generate_brief — LLM analysis → Smart Brief.
        3. ask_user(phase="brief") — emit brief for user confirmation.
        4. generate_blueprint — LLM planning → CreationBlueprint.
        5. ask_user(phase="blueprint") — emit blueprint for user confirmation.
        6. write_all_sections — generate content for each section with word budgets.
        7. save_draft — persist section drafts to draft_store.
        8. run_consistency_checks — validate cross-section coherence.
        9. finalize — merge sections + emit done event.

        Args:
            request: The orchestrator request.

        Returns:
            The final content string.
        """
        # 1. Parse assets if files present
        asset_map = None
        if request.files:
            asset_map = await parse_assets_tool(
                files=request.files,
                page_id=request.page_id,
            )

        # 2. Generate brief
        brief = await generate_brief(
            user_message=request.user_message,
            asset_map=asset_map,
            page_content=request.page_content or None,
            template_prompt=request.template_prompt or None,
            thread_id=request.thread_id,
        )

        # 3. Ask user to confirm brief
        await emit(request.thread_id, {
            "type": "await_input", "phase": "brief",
            "data": brief.model_dump(),
        })
        brief_response = await interaction_registry.wait_for_response(request.thread_id)
        # User may have modified the brief
        if isinstance(brief_response, dict) and brief_response.get("brief"):
            brief = CreationBrief.model_validate(brief_response["brief"])

        # 4. Generate blueprint
        blueprint = await generate_blueprint(
            user_message=request.user_message,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
        )

        # 5. Ask user to confirm blueprint
        await emit(request.thread_id, {
            "type": "await_input", "phase": "blueprint",
            "data": blueprint.model_dump(),
        })
        blueprint_response = await interaction_registry.wait_for_response(request.thread_id)
        if isinstance(blueprint_response, dict) and blueprint_response.get("blueprint"):
            blueprint = CreationBlueprint.model_validate(blueprint_response["blueprint"])

        # 6. Write all sections
        section_drafts = await write_all_sections(
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
            page_id=request.page_id,
        )

        # 7. Save draft
        draft_store.save_draft(
            workspace_id=request.workspace_id,
            page_id=request.page_id or "",
            task_id=request.thread_id,
            sections=section_drafts,
            blueprint_ref=blueprint.title,
        )

        # 8. Run consistency checks
        consistency_issues = run_consistency_checks(section_drafts, blueprint)

        # 9. Merge and finalize
        merged_sections = [
            {"title": s.title, "content": d.content}
            for s, d in zip(blueprint.sections, section_drafts)
        ]

        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=merged_sections,
            insert_mode=request.insert_mode,
        )

        return final_content
