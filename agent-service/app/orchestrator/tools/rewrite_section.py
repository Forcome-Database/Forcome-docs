"""Rewrite a single section based on user feedback.

Called when a user clicks "重写本章" on a completed section in Live Draft.
Re-runs SectionWriter for just that section, preserving sliding window context
from the existing adjacent sections.
"""
from __future__ import annotations
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap
from app.models.draft import SectionDraft
from app.workers.section_writer import (
    write_section, get_prev_section_tail, get_next_section_header,
)
from app.agent.events import emit


async def rewrite_section(
    *,
    section_id: str,
    feedback: str,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    existing_drafts: list[SectionDraft],
    asset_map: AssetMap | None = None,
    thread_id: str = "",
) -> SectionDraft:
    """Rewrite a single section with user feedback.

    Preserves sliding window context from adjacent sections.
    The feedback is appended to the section's prompt context.
    """
    # Find the section in blueprint
    section_index = next(
        (i for i, s in enumerate(blueprint.sections) if s.id == section_id),
        None
    )
    if section_index is None:
        raise ValueError(f"Section {section_id} not found in blueprint")

    section = blueprint.sections[section_index]

    await emit(thread_id, {
        "type": "step_start",
        "step": f"rewrite_{section_id}",
        "description": f"重写章节: {section.title}",
    })

    # Get sliding window context from existing drafts
    prev_tail = get_prev_section_tail(existing_drafts, section_index)
    next_header = get_next_section_header(blueprint, section_index)

    # Create a modified section with feedback appended to description
    modified_section = SectionPlan(
        id=section.id,
        title=section.title,
        level=section.level,
        word_budget=section.word_budget,
        description=f"{section.description}\n\n[User feedback for rewrite]: {feedback}",
        assets=section.assets,
        visuals=section.visuals,
        must_cover=section.must_cover,
    )

    new_draft = await write_section(
        section=modified_section,
        blueprint=blueprint,
        brief=brief,
        asset_map=asset_map,
        prev_section_tail=prev_tail,
        next_section_header=next_header,
        section_index=section_index,
        total_sections=len(blueprint.sections),
        thread_id=thread_id,
        max_retries=0,
    )

    await emit(thread_id, {
        "type": "step_done",
        "step": f"rewrite_{section_id}",
        "result_summary": f"重写完成: {new_draft.word_count} 字",
    })

    return new_draft
