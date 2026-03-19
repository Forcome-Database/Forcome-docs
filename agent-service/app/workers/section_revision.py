"""Section revision worker for targeted one-pass draft transforms."""
from __future__ import annotations

import re

from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief
from app.models.document_tree import build_section_node_id
from app.models.draft import SectionDraft
from app.orchestrator.llm_result import extract_text_output
from app.orchestrator.llm_factory import create_pydantic_ai_model
from app.utils.text import count_words
from app.workers.section_writer import ASSET_MARKER_RE, build_section_context


SECTION_REVISION_SYSTEM = """You are a precise section reviser.

You receive the original section context, the current section draft, and explicit revision requirements.

Rules:
1. Revise the provided draft instead of rewriting from scratch.
2. Keep the same section scope and preserve factual content unless a revision requirement says otherwise.
3. Preserve valid Markdown structure, source markers, links, tables, Mermaid blocks, and images whenever possible.
4. Apply only the requested changes needed to improve budget fit, source usage, or required visuals.
5. Output the complete revised section only, with no explanations.
"""


def _infer_revision_mode(section: SectionPlan, draft: SectionDraft) -> str:
    budget = section.word_budget
    if budget > 0:
        if draft.word_count > budget * 1.1:
            return "condense"
        if draft.word_count < budget * 0.9:
            return "expand"
    return "restructure"


async def revise_section_draft(
    *,
    draft: SectionDraft,
    section: SectionPlan,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
    prev_section_tail: str = "",
    next_section_header: str = "",
    section_index: int = 0,
    total_sections: int = 1,
    revision_notes: list[str] | None = None,
    thread_id: str = "",
    user_message: str = "",
    system_prompt: str = "",
    template_prompt: str = "",
    intent_route: str = "document_create",
) -> SectionDraft:
    """Apply one targeted revision pass to an existing section draft."""
    if not revision_notes:
        return draft

    from pydantic_ai import Agent

    context = build_section_context(
        section=section,
        blueprint=blueprint,
        brief=brief,
        asset_map=asset_map,
        prev_section_tail=prev_section_tail,
        next_section_header=next_section_header,
        section_index=section_index,
        total_sections=total_sections,
        user_message=user_message,
        system_prompt=system_prompt,
        template_prompt=template_prompt,
        intent_route=intent_route,
        generated_image_urls=draft.visuals_generated,
        revision_notes=revision_notes,
    )
    revision_mode = _infer_revision_mode(section, draft)

    prompt = (
        f"{context}\n\n"
        f"[Revision Mode] {revision_mode}\n"
        "[Existing Draft]\n"
        f"{draft.content}\n\n"
        "Revise the existing draft to satisfy the revision requirements. "
        "Return only the full revised section."
    )

    model = create_pydantic_ai_model()
    agent = Agent(model, system_prompt=SECTION_REVISION_SYSTEM)
    result = await agent.run(prompt)
    revised_text = extract_text_output(result)
    revised_word_count = count_words(revised_text)

    return SectionDraft(
        section_id=section.id,
        node_id=draft.node_id or build_section_node_id(section.id),
        content=revised_text,
        word_count=revised_word_count,
        budget_compliance=(revised_word_count / section.word_budget if section.word_budget > 0 else 1.0),
        assets_used=sorted(set(re.findall(ASSET_MARKER_RE, revised_text))),
        visuals_generated=list(draft.visuals_generated),
        write_attempts=draft.write_attempts + 1,
        image_status=draft.image_status,
        source_image_asset_id=draft.source_image_asset_id,
        degraded_reason=draft.degraded_reason,
    )
