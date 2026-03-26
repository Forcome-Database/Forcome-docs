"""Core orchestrator engine using PydanticAI.

The OrchestratorEngine receives a user request, analyzes its complexity,
and dispatches to the appropriate execution path.

Phase 1 implementation: Level 1 uses simple_edit → finalize.
Phase 2 implementation: Level 2 uses parse_assets → generate_brief →
    ask_user(brief) → generate_blueprint → ask_user(blueprint) → simple_edit → finalize.
Level 3 falls back to Level 1 pending Phase 3.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.agent.events import emit
from app.orchestrator.tools.complexity import analyze_task_complexity
from app.orchestrator.tools.finalize import document_tree_to_sections, finalize_and_emit
from app.orchestrator.tools.simple_edit import SimpleEditRequest, execute_simple_edit

# Phase 2 tools
from app.orchestrator.tools.parse_assets import parse_assets_tool
from app.orchestrator.tools.create_brief import generate_brief
from app.orchestrator.tools.create_blueprint import classify_blueprint_delta, generate_blueprint
from app.orchestrator.tools.user_interaction import interaction_registry
from app.orchestrator.tools.evidence import (
    build_evidence_snapshot,
    collect_evidence,
    failed_required_evidence,
)

# Phase 3 tools
from app.orchestrator.tools.write_tools import build_document_tree, render_document_tree_markdown, write_all_sections
from app.workers.consistency_checker import run_consistency_checks
from app.orchestrator.draft_manager import draft_store
from app.orchestrator.session_store import session_store
from app.models.brief import CreationBrief
from app.models.blueprint import CreationBlueprint
from app.models.document_tree import DocumentTree
from app.models.review import ReviewIssue
from app.models.session import SessionDraftSection
from app.models.document_task import DocumentTask

# Phase 4 tools
from app.orchestrator.tools.evaluate import evaluate_quality
from app.workers.fixer import apply_auto_fixes
from app.workers.researcher import research as research_tool
from app.orchestrator.review.review_loop import run_review_loop, L2_MESSAGES, L3_MESSAGES

import re as _re


def _extract_first_url(text: str) -> str | None:
    urls = _re.findall(r'https?://\S+', text)
    return urls[0].rstrip('.,)>') if urls else None


def _build_asset_summary(asset_map: object) -> dict:
    if not asset_map:
        return {
            "images": 0,
            "tables": 0,
            "code": 0,
            "text": 0,
            "source_word_count": 0,
            "source_section_counts": {},
        }

    return {
        "images": len(asset_map.items_by_type("image")),
        "tables": len(asset_map.items_by_type("table")),
        "code": len(asset_map.items_by_type("code")),
        "text": len(asset_map.items_by_type("text")),
        "source_word_count": asset_map.source_word_count,
        "source_section_counts": asset_map.source_section_counts,
    }


def _build_text_asset_context(asset_map: object | None) -> str:
    if not asset_map:
        print(f"[DEBUG _build_text_asset_context] asset_map is None/empty → returning ''")
        return ""

    sm = getattr(asset_map, "source_markdown", "")
    print(f"[DEBUG _build_text_asset_context] source_markdown len={len(sm)}, items={len(getattr(asset_map, 'items', []))}")

    # Build VLM image context as a SEPARATE section (not mixed into source doc)
    vlm_context = ""
    image_items = [i for i in asset_map.items if i.type == "image" and getattr(i, "caption", "") and len(i.caption) > 20]
    if image_items:
        vlm_parts = []
        for img in image_items:
            ref = img.content if not img.content.startswith("data:") else f"Image {img.source_page or '?'}"
            vlm_parts.append(f"[Image: {ref}]\n{img.caption[:300]}")
        vlm_context = "\n\n[Image Descriptions — for your understanding only, DO NOT include these in output]\n" + "\n\n".join(vlm_parts)

    # Prefer full source markdown
    if sm:
        title = getattr(asset_map, "document_title", "")
        header = f"--- Source Document: {title} ---\n" if title else ""
        result = header + asset_map.source_markdown
        if vlm_context:
            result += "\n\n" + vlm_context
        return result

    # Fallback: join all content-bearing items (text + table + code)
    relevant_types = {"text", "table", "code"}
    relevant_items = [item for item in asset_map.items if item.type in relevant_types]
    if not relevant_items:
        return vlm_context or ""

    parts: list[str] = []
    for item in relevant_items:
        parts.append(f"--- Source: {item.source or item.id} ---\n{item.content}")
    result = "\n\n".join(parts)
    if vlm_context:
        result += "\n\n" + vlm_context
    return result


def _should_promote_level2_to_structured_write(
    *,
    request: object,
    asset_map: object | None,
    brief: CreationBrief,
) -> bool:
    return False


def _should_require_brief_confirmation(request: "OrchestratorRequest") -> bool:
    document_task = request.document_task
    if (
        request.intent_route == "document_transform"
        and (
            document_task is None
            or document_task.mode == "strict_preservation"
        )
    ):
        return False

    return True


def _append_blueprint_audit_entry(
    thread_id: str,
    *,
    decision: Literal["auto_patch", "reconfirm_blueprint"],
    changes: list[str],
) -> None:
    session_store.append_blueprint_audit(
        session_id=thread_id,
        thread_id=thread_id,
        decision=decision,
        changes=changes,
    )


def _build_consistency_review_issues(consistency_issues: list[object]) -> list[ReviewIssue]:
    return [
        ReviewIssue(
            id=f"consistency-{uuid.uuid4().hex[:8]}",
            section_id=ci.section_id,
            severity="warning",
            category="structure" if ci.category in ("heading_level", "cross_reference") else "style",
            description=ci.description,
            suggestion="",
            auto_fixable=(ci.category == "heading_level"),
        )
        for ci in consistency_issues
    ]


def _build_section_alignment_issues(
    drafts: list[object],
    blueprint: CreationBlueprint,
) -> list[ReviewIssue]:
    expected_ids = [section.id for section in blueprint.sections]
    actual_ids = [draft.section_id for draft in drafts]
    issues: list[ReviewIssue] = []

    if actual_ids == expected_ids:
        return issues

    missing_ids = [section.id for section in blueprint.sections if section.id not in actual_ids]
    unexpected_ids = [section_id for section_id in actual_ids if section_id not in expected_ids]

    if missing_ids:
        missing_titles = [
            section.title for section in blueprint.sections if section.id in missing_ids
        ]
        issues.append(
            ReviewIssue(
                id=f"alignment-{uuid.uuid4().hex[:8]}",
                severity="error",
                category="structure",
                description=f"最终草稿缺少章节: {', '.join(missing_titles)}",
                suggestion="必须补齐 blueprint 中的所有章节后才能完成",
                auto_fixable=False,
            )
        )

    if unexpected_ids:
        issues.append(
            ReviewIssue(
                id=f"alignment-{uuid.uuid4().hex[:8]}",
                severity="error",
                category="structure",
                description=f"最终草稿出现 blueprint 之外的章节: {', '.join(unexpected_ids)}",
                suggestion="移除额外章节，并确保章节集合与 blueprint 完全一致",
                auto_fixable=False,
            )
        )

    if not missing_ids and not unexpected_ids and actual_ids != expected_ids:
        issues.append(
            ReviewIssue(
                id=f"alignment-{uuid.uuid4().hex[:8]}",
                severity="error",
                category="structure",
                description="最终草稿章节顺序与 blueprint 不一致",
                suggestion="按 blueprint.sections 的顺序重新排列并重写受影响章节",
                auto_fixable=False,
            )
        )

    return issues


def _has_blocking_review_issues(
    report: object,
    *,
    allow_visual_skip: bool = False,
) -> bool:
    for issue in report.issues:
        if issue.fixed or issue.auto_fixable:
            continue
        if issue.severity != "error":
            continue
        if allow_visual_skip and issue.category == "visual":
            continue
        return True
    return False


def _build_draft_snapshot(
    blueprint: CreationBlueprint,
    section_drafts: list[object],
) -> tuple[str, list[SessionDraftSection], DocumentTree]:
    document_tree = build_document_tree(blueprint, section_drafts)
    markdown = render_document_tree_markdown(document_tree)
    sections = [
        SessionDraftSection(
            node_id=getattr(draft, "node_id", "") or f"section:{section.id}",
            section_id=section.id,
            title=section.title,
            level=section.level,
            content=draft.content,
            write_attempts=getattr(draft, "write_attempts", 1),
            image_status=getattr(draft, "image_status", "not_requested"),
            source_image_asset_id=getattr(draft, "source_image_asset_id", None),
            degraded_reason=getattr(draft, "degraded_reason", None),
        )
        for section, draft in zip(blueprint.sections, section_drafts)
    ]
    return markdown, sections, document_tree


def _evidence_block_event() -> dict:
    return {
        "type": "blocked",
        "kind": "evidence",
        "message": "Required evidence could not be collected",
        "required_action": "Retry the failed evidence step or remove the missing source",
        "allowed_resolutions": ["retry", "remove_source"],
    }


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

    @field_validator(
        "page_content", "selected_text", "system_prompt", "template_prompt",
        mode="before",
    )
    @classmethod
    def coerce_none_to_empty(cls, v: object) -> str:
        return v if v is not None else ""

    # Files as minimal metadata dicts ({"name": str, "type": str})
    files: list[dict] = Field(default_factory=list)

    # Routing
    intent_route: Literal[
        "selection_edit", "document_transform", "document_create"
    ] = "document_create"
    document_task: DocumentTask | None = None
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

        # Emit routing decision event for frontend transparency
        await emit(
            request.thread_id,
            {
                "type": "routing_decision",
                "task_type": request.intent_route,
                "strategy": f"level_{complexity['level']}",
                "reason": complexity["reasoning"],
                "confidence": 1.0,
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

    async def _await_user_input(
        self,
        *,
        thread_id: str,
        phase: Literal["brief", "blueprint", "review"],
        data: dict,
        timeout_message: str,
        raise_on_timeout: bool = True,
    ) -> dict | None:
        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            run_state="awaiting_input",
            phase=phase,
            pending_decision={"phase": phase, "data": data},
            blocked=None,
        )
        interaction_registry.register(thread_id)
        await emit(
            thread_id,
            {
                "type": "await_input",
                "phase": phase,
                "data": data,
            },
        )
        try:
            response = await interaction_registry.wait_for_response(thread_id)
        except asyncio.TimeoutError:
            session_store.upsert_session(
                session_id=thread_id,
                thread_id=thread_id,
                run_state="error",
                phase=phase,
                last_error=timeout_message,
            )
            await emit(thread_id, {"type": "error", "message": timeout_message})
            interaction_registry.cleanup(thread_id)
            if raise_on_timeout:
                raise
            return None

        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            run_state="running",
            phase=phase,
            pending_decision=None,
            blocked=None,
        )
        return response if isinstance(response, dict) else None

    async def _emit_draft_preview(
        self,
        *,
        thread_id: str,
        blueprint: CreationBlueprint,
        section_drafts: list,
    ) -> None:
        preview, sections, document_tree = _build_draft_snapshot(blueprint, section_drafts)

        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            draft_markdown=preview,
            draft_sections=sections,
            document_tree=document_tree,
        )

        await emit(thread_id, {"type": "draft_patch", "markdown": preview, "sections": [section.model_dump() for section in sections]})
        await emit(thread_id, {"type": "content_clear"})
        for index in range(0, len(preview), 1200):
            await emit(thread_id, {"type": "content", "chunk": preview[index:index + 1200]})

    async def _confirm_blueprint(
        self,
        *,
        thread_id: str,
        blueprint: CreationBlueprint,
    ) -> CreationBlueprint:
        current_blueprint = blueprint

        while True:
            blueprint_response = await self._await_user_input(
                thread_id=thread_id,
                phase="blueprint",
                data={
                    "type": "blueprint",
                    "blueprint": current_blueprint.model_dump(),
                },
                timeout_message="Timed out waiting for blueprint confirmation (10 min). Task cancelled.",
            )

            if not isinstance(blueprint_response, dict) or not blueprint_response.get("blueprint"):
                break

            proposed_blueprint = CreationBlueprint.model_validate(blueprint_response["blueprint"])
            assessment = classify_blueprint_delta(current_blueprint, proposed_blueprint)
            _append_blueprint_audit_entry(
                thread_id,
                decision=assessment.decision,
                changes=assessment.changes,
            )

            if assessment.decision == "auto_patch":
                current_blueprint = proposed_blueprint
                session_store.upsert_session(
                    session_id=thread_id,
                    thread_id=thread_id,
                    phase="blueprint",
                    blueprint=current_blueprint,
                    pending_blueprint_patch=None,
                    pending_decision=None,
                )
                break

            current_blueprint = proposed_blueprint
            session_store.upsert_session(
                session_id=thread_id,
                thread_id=thread_id,
                phase="blueprint",
                pending_blueprint_patch=current_blueprint,
            )

        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            phase="blueprint_confirmed",
            blueprint=current_blueprint,
            pending_blueprint_patch=None,
            pending_decision=None,
        )
        return current_blueprint

    async def _build_review_report(
        self,
        *,
        section_drafts: list,
        blueprint: CreationBlueprint,
        brief: CreationBrief,
        asset_map: object,
        thread_id: str,
    ):
        consistency_review_issues = _build_consistency_review_issues(
            run_consistency_checks(section_drafts, blueprint)
        )
        alignment_issues = _build_section_alignment_issues(section_drafts, blueprint)

        review_report = await evaluate_quality(
            drafts=section_drafts,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=thread_id,
        )

        if consistency_review_issues:
            review_report.issues.extend(consistency_review_issues)
        if alignment_issues:
            review_report.issues.extend(alignment_issues)

        section_levels = {section.id: section.level for section in blueprint.sections}
        section_titles = {section.id: section.title for section in blueprint.sections}
        auto_fixable = [issue for issue in review_report.issues if issue.auto_fixable and not issue.fixed]
        auto_count = 0
        if auto_fixable:
            section_drafts, auto_count = apply_auto_fixes(
                section_drafts,
                review_report.issues,
                section_levels,
                section_titles,
            )

        review_report.auto_fixed_count = auto_count
        review_report.user_decision_needed = [
            issue.id for issue in review_report.issues if not issue.auto_fixable and not issue.fixed
        ]
        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            review_report=review_report,
        )
        return review_report, section_drafts

    async def _prepare_evidence(
        self,
        request: OrchestratorRequest,
        *,
        page_id_for_assets: str | None = None,
    ):
        asset_map = None
        parse_error = None
        print(f"\n[DEBUG _prepare_evidence] files={len(request.files)}, page_id_for_assets={page_id_for_assets}")
        if request.files:
            try:
                parse_kwargs = {"files": request.files}
                if page_id_for_assets is not None:
                    parse_kwargs["page_id"] = page_id_for_assets
                asset_map = await parse_assets_tool(**parse_kwargs)
                print(f"[DEBUG _prepare_evidence] parse SUCCESS:")
                print(f"[DEBUG]   items={len(asset_map.items) if asset_map else 0}")
                print(f"[DEBUG]   source_markdown len={len(asset_map.source_markdown) if asset_map else 0}")
                print(f"[DEBUG]   word_count={asset_map.source_word_count if asset_map else 0}")
                if asset_map and asset_map.source_markdown:
                    print(f"[DEBUG]   source_markdown first 200 chars: {asset_map.source_markdown[:200]}")
            except Exception as exc:
                parse_error = str(exc)[:200]
                print(f"[DEBUG _prepare_evidence] parse FAILED: {parse_error}")
                logger.error(
                    "parse_assets_failed",
                    extra={"error": parse_error, "file_count": len(request.files)},
                )
                await emit(
                    request.thread_id,
                    {"type": "error", "error": f"Document parsing failed: {parse_error}"},
                )
        else:
            print(f"[DEBUG _prepare_evidence] NO FILES in request")

        asset_map, evidence_items = await collect_evidence(
            request,
            asset_map=asset_map,
            parse_error=parse_error,
        )
        snapshot = build_evidence_snapshot(evidence_items)
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            **snapshot,
        )
        return asset_map, evidence_items

    async def _emit_evidence_block(
        self,
        *,
        thread_id: str,
        evidence_items: list,
    ) -> str:
        blocked_event = _evidence_block_event()
        snapshot = build_evidence_snapshot(evidence_items)
        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            run_state="blocked",
            phase="evidence",
            blocked={k: v for k, v in blocked_event.items() if k != "type"},
            block_resolution_choices=blocked_event["allowed_resolutions"],
            **snapshot,
        )
        await emit(thread_id, blocked_event)
        return ""

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
            asset_map=None,
        )

        return final_content

    async def _execute_preservation_patch(self, request: OrchestratorRequest) -> str:
        """Execute strict-preservation document transforms without brief/blueprint steps.

        When source files are present with parsed markdown, bypass the LLM entirely
        and use the parsed+image-rewritten markdown directly. This preserves the
        original document structure, image positions, and content exactly as parsed.
        Only falls back to LLM-based editing when no source markdown is available.
        """
        asset_map, evidence_items = await self._prepare_evidence(
            request,
            page_id_for_assets=request.page_id,
        )
        if failed_required_evidence(evidence_items):
            return await self._emit_evidence_block(
                thread_id=request.thread_id,
                evidence_items=evidence_items,
            )

        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            phase="preservation_patch",
            pending_decision=None,
            blocked=None,
        )

        # Use LLM to optimize the parsed content while preserving structure.
        # Pass the full source markdown so LLM sees the complete document
        # with images in correct positions.
        source_md = getattr(asset_map, "source_markdown", "") if asset_map else ""
        print(f"\n[DEBUG _execute_preservation_patch]")
        print(f"[DEBUG]   source_md len={len(source_md)}")
        print(f"[DEBUG]   has files={bool(request.files)}, file_count={len(request.files)}")
        print(f"[DEBUG]   user_message={request.user_message[:80]}")
        # REMOVED direct insert — always use LLM for optimization
        # The previous direct insert produced no optimization at all
        if False:  # disabled — LLM path below handles all cases
            logger.info(
                "preservation_patch_direct_insert",
                extra={"word_count": len(source_md.split()), "thread_id": request.thread_id},
            )
            await emit(request.thread_id, {
                "type": "step_start",
                "step": "preservation_patch",
                "description": "Applying parsed document directly (strict preservation)…",
            })

            # Stream the source markdown as content events for UI feedback
            chunk_size = 200
            for i in range(0, len(source_md), chunk_size):
                await emit(request.thread_id, {
                    "type": "content",
                    "chunk": source_md[i:i + chunk_size],
                })

            await emit(request.thread_id, {
                "type": "step_done",
                "step": "preservation_patch",
                "result_summary": f"Document preserved ({len(source_md.split())} words, images intact)",
            })

            final_content = await finalize_and_emit(
                thread_id=request.thread_id,
                sections=[source_md],
                insert_mode=request.insert_mode,
                asset_map=None,
            )
            return final_content

        # Fallback: no source markdown available — use LLM-based editing
        asset_context = _build_text_asset_context(asset_map)
        preservation_instructions = (
            "[Document Optimization Instructions]\n"
            "You must output the source document with IMPROVED formatting.\n\n"
            "ABSOLUTE RULES (violations = failure):\n"
            "1. Output EVERY image reference exactly as: ![](url) — copy each ![...](/api/files/...) line verbatim.\n"
            "   NEVER remove, reorder, or modify image references. They MUST appear in original order.\n"
            "2. Keep ALL original text content. Do not remove, summarize, or skip any paragraph.\n"
            "3. Keep all URLs and technical details exactly as they are.\n\n"
            "FORMATTING IMPROVEMENTS:\n"
            "- Add proper markdown headings (# ## ###) for sections.\n"
            "- Use numbered lists for step-by-step instructions.\n"
            "- Bold key terms and important warnings.\n"
            "- Add blank lines between sections for readability.\n\n"
            "FORBIDDEN:\n"
            "- Do NOT output image descriptions or captions from the [Image Descriptions] section.\n"
            "- Do NOT describe what images show — just keep the ![](url) references.\n"
            "- Do NOT add content not in the source document.\n"
            "- Do NOT output the [Image Descriptions] section."
        )
        merged_asset_context = (
            f"{asset_context}\n\n{preservation_instructions}"
            if asset_context
            else preservation_instructions
        )

        edit_request = SimpleEditRequest(
            thread_id=request.thread_id,
            user_message=request.user_message,
            page_content=request.page_content,
            selected_text=request.selected_text,
            system_prompt=request.system_prompt,
            template_prompt=request.template_prompt,
            conversation_history=request.conversation_history,
            intent_route=request.intent_route,
            asset_context=merged_asset_context,
        )

        edited_content = await execute_simple_edit(edit_request)

        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=[edited_content],
            insert_mode=request.insert_mode,
            asset_map=asset_map,
        )

        return final_content

    async def _execute_level2(self, request: OrchestratorRequest) -> str:
        """Execute a Level 2 (structured creation with brief, no blueprint) task.

        L2 pipeline (design doc aligned):
        1. parse_assets — parse uploaded files into AssetMap (if files present).
        2. generate_brief — LLM analysis → Smart Brief.
        3. ask_user(phase="brief") — emit brief for user confirmation, wait.
        4. simple_edit — single-pass writing with asset context + brief guidance.
        5. finalize — merge + done event.

        Args:
            request: The orchestrator request.

        Returns:
            The final content string.
        """
        asset_map, evidence_items = await self._prepare_evidence(
            request,
            page_id_for_assets=request.page_id,
        )
        if failed_required_evidence(evidence_items):
            return await self._emit_evidence_block(
                thread_id=request.thread_id,
                evidence_items=evidence_items,
            )

        # Step 2: Generate Smart Brief
        brief = await generate_brief(
            user_message=request.user_message,
            asset_map=asset_map,
            page_content=request.page_content or None,
            template_prompt=request.template_prompt or None,
            thread_id=request.thread_id,
        )
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            phase="brief",
            brief=brief,
        )
        if _should_require_brief_confirmation(request):
            brief_response = await self._await_user_input(
                thread_id=request.thread_id,
                phase="brief",
                data={
                    "type": "brief",
                    "brief": brief.model_dump(),
                    "asset_summary": _build_asset_summary(asset_map),
                },
                timeout_message="Timed out waiting for brief confirmation.",
            )
            if isinstance(brief_response, dict) and brief_response.get("brief"):
                brief = CreationBrief.model_validate(brief_response["brief"])
        else:
            session_store.upsert_session(
                session_id=request.thread_id,
                thread_id=request.thread_id,
                phase="brief_confirmed",
                brief=brief,
                pending_decision=None,
            )

        if _should_promote_level2_to_structured_write(
            request=request,
            asset_map=asset_map,
            brief=brief,
        ):
            await emit(
                request.thread_id,
                {
                    "type": "step_start",
                    "step": "upgrade_level2",
                    "description": "Upgrading to structured write flow to preserve source images…",
                },
            )
            await emit(
                request.thread_id,
                {
                    "type": "step_done",
                    "step": "upgrade_level2",
                    "result_summary": "Using blueprint + section writer because source images must be preserved",
                },
            )
            return await self._execute_structured_write_from_brief(
                request=request,
                asset_map=asset_map,
                brief=brief,
            )

        # Step 4: Build asset context for simple_edit
        asset_context = _build_text_asset_context(asset_map)

        brief_summary = (
            f"[Smart Brief]\n"
            f"Goal: {brief.goal}\n"
            f"Audience: {brief.audience}\n"
            f"Style: {brief.style}\n"
            f"Target length: {brief.target_length} 字/words\n"
            f"Image strategy: {brief.image_strategy}"
        )

        edit_request = SimpleEditRequest(
            thread_id=request.thread_id,
            user_message=request.user_message,
            page_content=request.page_content,
            selected_text=request.selected_text,
            system_prompt=request.system_prompt,
            template_prompt=request.template_prompt,
            conversation_history=request.conversation_history,
            intent_route=request.intent_route,
            asset_context=f"{asset_context}\n\n{brief_summary}" if asset_context else brief_summary,
        )

        edited_content = await execute_simple_edit(edit_request)

        # Step 5: Finalize
        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=[edited_content],
            insert_mode=request.insert_mode,
            asset_map=asset_map,
        )

        return final_content

    async def _execute_structured_write_from_brief(
        self,
        *,
        request: OrchestratorRequest,
        asset_map: object | None,
        brief: CreationBrief,
    ) -> str:
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            phase="brief_confirmed",
            brief=brief,
            pending_decision=None,
        )

        blueprint = await generate_blueprint(
            user_message=request.user_message,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
        )
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            phase="blueprint",
            blueprint=blueprint,
        )

        blueprint = await self._confirm_blueprint(
            thread_id=request.thread_id,
            blueprint=blueprint,
        )

        section_drafts = await write_all_sections(
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
            page_id=request.page_id,
            user_message=request.user_message,
            system_prompt=request.system_prompt,
            template_prompt=request.template_prompt,
            intent_route=request.intent_route,
        )
        await self._emit_draft_preview(
            thread_id=request.thread_id,
            blueprint=blueprint,
            section_drafts=section_drafts,
        )

        draft_store.save_draft(
            workspace_id=request.workspace_id,
            page_id=request.page_id or "",
            task_id=request.thread_id,
            sections=section_drafts,
            blueprint_ref=blueprint.title,
        )

        review_report, section_drafts = await self._build_review_report(
            section_drafts=section_drafts,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
        )

        section_drafts = await run_review_loop(
            review_report=review_report,
            section_drafts=section_drafts,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
            page_id=request.page_id,
            messages=L2_MESSAGES,
            await_user_input=self._await_user_input,
            build_review_report=self._build_review_report,
            emit_draft_preview=self._emit_draft_preview,
            has_blocking_issues=_has_blocking_review_issues,
        )

        if _build_section_alignment_issues(section_drafts, blueprint):
            raise RuntimeError(L2_MESSAGES.alignment_error)

        document_tree = build_document_tree(blueprint, section_drafts)

        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=document_tree_to_sections(document_tree),
            insert_mode=request.insert_mode,
            asset_map=asset_map,
        )
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            run_state="completed",
            phase="done",
            pending_decision=None,
            blocked=None,
            final_content=final_content,
            draft_markdown=final_content,
            document_tree=document_tree,
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
        asset_map, evidence_items = await self._prepare_evidence(
            request,
            page_id_for_assets=request.page_id,
        )
        if failed_required_evidence(evidence_items):
            return await self._emit_evidence_block(
                thread_id=request.thread_id,
                evidence_items=evidence_items,
            )

        # 1b. Research step — if no uploaded files, gather web research
        has_text_assets = bool(asset_map and asset_map.items)
        has_sufficient_evidence = has_text_assets
        if not has_sufficient_evidence:
            await emit(request.thread_id, {
                "type": "step_start",
                "step": "research",
                "description": "Researching topic…",
            })
            try:
                research_results: list[dict] = []
                web_url = _extract_first_url(request.user_message)

                research_results.extend(await research_tool(
                    query=request.user_message,
                    sources=["web_search"],
                    thread_id=request.thread_id,
                    workspace_id=request.workspace_id,
                ))

                if request.workspace_id:
                    research_results.extend(await research_tool(
                        query=request.user_message,
                        sources=["knowledge_base"],
                        thread_id=request.thread_id,
                        workspace_id=request.workspace_id,
                    ))

                if request.page_id:
                    research_results.extend(await research_tool(
                        query=request.page_id,
                        sources=["page_read"],
                        thread_id=request.thread_id,
                        workspace_id=request.workspace_id,
                    ))

                if web_url:
                    research_results.extend(await research_tool(
                        query=web_url,
                        sources=["web_crawl"],
                        thread_id=request.thread_id,
                        workspace_id=request.workspace_id,
                    ))

                if research_results:
                    from app.models.asset_map import AssetItem
                    if asset_map is None:
                        from app.models.asset_map import AssetMap
                        asset_map = AssetMap()
                    for i, r in enumerate(research_results):
                        content = (r.get("content") or "").strip()
                        if not content:
                            continue
                        asset_map.items.append(AssetItem(
                            id=f"research_{i}",
                            type="text",
                            source=r.get("source", "research"),
                            content=content[:3000],
                            summary=(r.get("url") or r.get("source") or "research result")[:200],
                        ))
                        asset_map.source_word_count += len(content[:3000])
                await emit(request.thread_id, {
                    "type": "step_done",
                    "step": "research",
                    "result_summary": f"Found {len(research_results)} results",
                })
            except Exception as e:
                await emit(request.thread_id, {
                    "type": "step_done",
                    "step": "research",
                    "result_summary": f"Research skipped: {str(e)[:80]}",
                })

        # 2. Generate brief
        brief = await generate_brief(
            user_message=request.user_message,
            asset_map=asset_map,
            page_content=request.page_content or None,
            template_prompt=request.template_prompt or None,
            thread_id=request.thread_id,
        )

        # 3. Ask user to confirm brief
        brief_response = await self._await_user_input(
            thread_id=request.thread_id,
            phase="brief",
            data={
                "type": "brief",
                "brief": brief.model_dump(),
                "asset_summary": _build_asset_summary(asset_map),
            },
            timeout_message="等待 Brief 确认超时（10分钟），任务已取消",
        )
        # User may have modified the brief
        if isinstance(brief_response, dict) and brief_response.get("brief"):
            brief = CreationBrief.model_validate(brief_response["brief"])
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            phase="brief_confirmed",
            brief=brief,
            pending_decision=None,
        )

        # 4. Generate blueprint
        blueprint = await generate_blueprint(
            user_message=request.user_message,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
        )
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            phase="blueprint",
            blueprint=blueprint,
        )

        # 5. Ask user to confirm blueprint
        blueprint = await self._confirm_blueprint(
            thread_id=request.thread_id,
            blueprint=blueprint,
        )

        # 6. Write all sections
        section_drafts = await write_all_sections(
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
            page_id=request.page_id,
            user_message=request.user_message,
            system_prompt=request.system_prompt,
            template_prompt=request.template_prompt,
            intent_route=request.intent_route,
        )
        await self._emit_draft_preview(
            thread_id=request.thread_id,
            blueprint=blueprint,
            section_drafts=section_drafts,
        )

        # 7. Save draft
        draft_store.save_draft(
            workspace_id=request.workspace_id,
            page_id=request.page_id or "",
            task_id=request.thread_id,
            sections=section_drafts,
            blueprint_ref=blueprint.title,
        )

        review_report, section_drafts = await self._build_review_report(
            section_drafts=section_drafts,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
        )

        section_drafts = await run_review_loop(
            review_report=review_report,
            section_drafts=section_drafts,
            blueprint=blueprint,
            brief=brief,
            asset_map=asset_map,
            thread_id=request.thread_id,
            page_id=request.page_id,
            messages=L3_MESSAGES,
            await_user_input=self._await_user_input,
            build_review_report=self._build_review_report,
            emit_draft_preview=self._emit_draft_preview,
            has_blocking_issues=_has_blocking_review_issues,
        )

        if _build_section_alignment_issues(section_drafts, blueprint):
            raise RuntimeError(L3_MESSAGES.alignment_error)

        # 9. Merge and finalize — derive final markdown from the canonical document tree
        document_tree = build_document_tree(blueprint, section_drafts)

        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            sections=document_tree_to_sections(document_tree),
            insert_mode=request.insert_mode,
            asset_map=asset_map,
        )
        session_store.upsert_session(
            session_id=request.thread_id,
            thread_id=request.thread_id,
            run_state="completed",
            phase="done",
            pending_decision=None,
            blocked=None,
            final_content=final_content,
            draft_markdown=final_content,
            document_tree=document_tree,
        )

        return final_content
