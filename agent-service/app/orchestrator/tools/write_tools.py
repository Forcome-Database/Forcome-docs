"""Write section tools for the orchestrator."""
from __future__ import annotations
import asyncio
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap
from app.models.draft import SectionDraft
from app.workers.section_writer import (
    write_section, get_prev_section_tail, get_next_section_header,
    generate_section_visuals,
)
from app.agent.events import emit


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
) -> SectionDraft:
    """Write a single section with full context."""
    drafts = existing_drafts or []

    prev_tail = get_prev_section_tail(drafts, section_index)
    next_header = get_next_section_header(blueprint, section_index)

    # Generate AI images first if needed
    generated_urls = await generate_section_visuals(
        section, asset_map, thread_id, page_id
    )

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
    )

    draft.visuals_generated = generated_urls
    return draft


async def write_all_sections(
    *,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
    thread_id: str = "",
    page_id: str | None = None,
    parallel: bool = False,
) -> list[SectionDraft]:
    """Write all sections sequentially (default) or with limited parallelism.

    Sequential writing is default because each section needs the previous section's
    tail for the sliding window context. Parallel writing groups non-adjacent sections.
    """
    drafts: list[SectionDraft] = []

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
            )
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
            )
            for i, s in even_sections
        ]
        even_results = await asyncio.gather(*even_tasks)

        # Build draft list with placeholders for odd sections
        drafts = [SectionDraft(section_id="placeholder")] * len(blueprint.sections)
        for (i, _), result in zip(even_sections, even_results):
            drafts[i] = result

        # Second pass: write odd-indexed sections (now have even neighbors)
        odd_sections = [(i, s) for i, s in enumerate(blueprint.sections) if i % 2 == 1]
        odd_tasks = [
            write_single_section(
                section=s, blueprint=blueprint, brief=brief,
                asset_map=asset_map, existing_drafts=drafts,
                section_index=i, thread_id=thread_id, page_id=page_id,
            )
            for i, s in odd_sections
        ]
        odd_results = await asyncio.gather(*odd_tasks)
        for (i, _), result in zip(odd_sections, odd_results):
            drafts[i] = result

    return drafts
