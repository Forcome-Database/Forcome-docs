"""Write section tools for the orchestrator."""
from __future__ import annotations
import asyncio
import re
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap
from app.models.draft import SectionDraft
from app.models.document_tree import DocumentNode, DocumentTree, DOCUMENT_TITLE_NODE_ID, build_section_node_id
from app.orchestrator.tools.finalize import document_tree_to_sections, merge_sections
from app.workers.section_writer import (
    write_section, get_prev_section_tail, get_next_section_header,
    materialize_section_visuals,
)
from app.workers.section_revision import revise_section_draft
from app.agent.events import emit


def _build_local_recovery_notes(section: SectionPlan, draft: SectionDraft) -> list[str]:
    notes: list[str] = []
    budget = section.word_budget
    actual = draft.word_count

    if budget > 0:
        if actual < budget * 0.9:
            notes.append(
                f"Expand this section to the target budget of about {budget} words/characters; the current draft is only {actual}."
            )
        elif actual > budget * 1.1:
            notes.append(
                f"Condense this section to stay near the target budget of {budget} words/characters; the current draft is {actual}."
            )

    missing_assets = [asset_id for asset_id in section.assets if asset_id not in draft.assets_used]
    if missing_assets:
        notes.append(
            "Materially use the assigned source assets and include their markers: "
            + ", ".join(missing_assets)
        )

    return notes


async def _emit_section_state(thread_id: str, draft: SectionDraft) -> None:
    await emit(
        thread_id,
        {
            "type": "section_state",
            "section_id": draft.section_id,
            "write_attempts": draft.write_attempts,
            "image_status": draft.image_status,
            "source_image_asset_id": draft.source_image_asset_id,
            "degraded_reason": draft.degraded_reason,
        },
    )


def build_document_tree(
    blueprint: CreationBlueprint,
    drafts: list[SectionDraft],
) -> DocumentTree:
    drafts_by_section = {draft.section_id: draft for draft in drafts}
    return DocumentTree(
        root=DocumentNode(
            node_id=DOCUMENT_TITLE_NODE_ID,
            title=blueprint.title,
            level=1,
            content="",
        ),
        sections=[
            DocumentNode(
                node_id=(
                    drafts_by_section.get(section.id).node_id
                    if drafts_by_section.get(section.id) and drafts_by_section.get(section.id).node_id
                    else build_section_node_id(section.id)
                ),
                section_id=section.id,
                title=section.title,
                level=section.level,
                content=drafts_by_section.get(section.id).content if drafts_by_section.get(section.id) else "",
            )
            for section in blueprint.sections
        ],
    )


def render_document_tree_markdown(document_tree: DocumentTree) -> str:
    return merge_sections(document_tree_to_sections(document_tree))


async def write_single_section(
    *,
    section: SectionPlan,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
    existing_drafts: list[SectionDraft] | None = None,
    section_index: int = 0,
    thread_id: str = "",
    page_id: str | None = None,
    user_message: str = "",
    system_prompt: str = "",
    template_prompt: str = "",
    intent_route: str = "document_create",
    recovery_notes: list[str] | None = None,
) -> SectionDraft:
    """Write a single section with full context."""
    drafts = existing_drafts or []

    prev_tail = get_prev_section_tail(drafts, section_index)
    next_header = get_next_section_header(blueprint, section_index)

    # Emit progress
    await emit(thread_id, {
        "type": "section_progress",
        "current": section_index + 1,
        "total": len(blueprint.sections),
        "section_title": section.title,
    })

    draft = await write_section(
        section=section,
        blueprint=blueprint,
        brief=brief,
        asset_map=asset_map,
        prev_section_tail=prev_tail,
        next_section_header=next_header,
        section_index=section_index,
        total_sections=len(blueprint.sections),
        thread_id=thread_id,
        user_message=user_message,
        system_prompt=system_prompt,
        template_prompt=template_prompt,
        intent_route=intent_route,
        revision_notes=recovery_notes,
    )
    if not draft.node_id:
        draft.node_id = build_section_node_id(section.id)
    return draft


async def write_all_sections(
    *,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
    thread_id: str = "",
    page_id: str | None = None,
    parallel: bool = False,
    user_message: str = "",
    system_prompt: str = "",
    template_prompt: str = "",
    intent_route: str = "document_create",
) -> list[SectionDraft]:
    """Write all sections sequentially (default) or with limited parallelism.

    Sequential writing is default because each section needs the previous section's
    tail for the sliding window context. Parallel writing groups non-adjacent sections.
    """
    drafts: list[SectionDraft] = []

    ctx_kwargs = dict(
        user_message=user_message,
        system_prompt=system_prompt,
        template_prompt=template_prompt,
        intent_route=intent_route,
    )

    if not parallel:
        # Sequential: each section uses previous section's tail
        for i, section in enumerate(blueprint.sections):
            draft = await write_single_section(
                section=section,
                blueprint=blueprint,
                brief=brief,
                asset_map=asset_map,
                existing_drafts=drafts,
                section_index=i,
                thread_id=thread_id,
                page_id=page_id,
                **ctx_kwargs,
            )

            recovery_notes = _build_local_recovery_notes(section, draft)
            if recovery_notes:
                await emit(
                    thread_id,
                    {
                        "type": "step_start",
                        "step": f"revise_section_{section.id}",
                        "description": f"Revising {section.title} to satisfy section constraints",
                    },
                )
                draft = await revise_section_draft(
                    draft=draft,
                    section=section,
                    blueprint=blueprint,
                    brief=brief,
                    asset_map=asset_map,
                    prev_section_tail=get_prev_section_tail(drafts, i),
                    next_section_header=get_next_section_header(blueprint, i),
                    section_index=i,
                    total_sections=len(blueprint.sections),
                    revision_notes=recovery_notes,
                    thread_id=thread_id,
                    **ctx_kwargs,
                )
                await emit(
                    thread_id,
                    {
                        "type": "step_done",
                        "step": f"revise_section_{section.id}",
                        "result_summary": f"{draft.word_count} words after targeted revision",
                    },
                )
            draft = await materialize_section_visuals(
                draft=draft,
                section=section,
                asset_map=asset_map,
                thread_id=thread_id,
                page_id=page_id,
            )
            await _emit_section_state(thread_id, draft)
            drafts.append(draft)
    else:
        # Parallel: group odd/even sections (non-adjacent can run concurrently)
        # First pass: write even-indexed sections
        even_sections = [(i, s) for i, s in enumerate(blueprint.sections) if i % 2 == 0]
        even_tasks = [
            write_single_section(
                section=s, blueprint=blueprint, brief=brief,
                asset_map=asset_map, existing_drafts=drafts,
                section_index=i, thread_id=thread_id, page_id=page_id,
                **ctx_kwargs,
            )
            for i, s in even_sections
        ]
        even_results = await asyncio.gather(*even_tasks)

        # Build draft list with placeholders for odd sections
        drafts = [SectionDraft(section_id="placeholder")] * len(blueprint.sections)
        for (i, _), result in zip(even_sections, even_results):
            result = await materialize_section_visuals(
                draft=result,
                section=blueprint.sections[i],
                asset_map=asset_map,
                thread_id=thread_id,
                page_id=page_id,
            )
            await _emit_section_state(thread_id, result)
            drafts[i] = result

        # Second pass: write odd-indexed sections (now have even neighbors)
        odd_sections = [(i, s) for i, s in enumerate(blueprint.sections) if i % 2 == 1]
        odd_tasks = [
            write_single_section(
                section=s, blueprint=blueprint, brief=brief,
                asset_map=asset_map, existing_drafts=drafts,
                section_index=i, thread_id=thread_id, page_id=page_id,
                **ctx_kwargs,
            )
            for i, s in odd_sections
        ]
        odd_results = await asyncio.gather(*odd_tasks)
        for (i, _), result in zip(odd_sections, odd_results):
            result = await materialize_section_visuals(
                draft=result,
                section=blueprint.sections[i],
                asset_map=asset_map,
                thread_id=thread_id,
                page_id=page_id,
            )
            await _emit_section_state(thread_id, result)
            drafts[i] = result

    return drafts
