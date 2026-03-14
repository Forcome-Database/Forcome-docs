"""SectionWriter Worker — generates one document section at a time.

Uses a carefully crafted context package to maintain coherence across sections.
Enforces word budget with a retry mechanism.
"""
from __future__ import annotations
import asyncio
from app.models.blueprint import SectionPlan, CreationBlueprint
from app.models.draft import SectionDraft
from app.models.asset_map import AssetMap, AssetItem
from app.models.brief import CreationBrief
from app.utils.text import count_words
from app.agent.events import emit
from app.orchestrator.llm_factory import create_pydantic_ai_model


SECTION_WRITER_SYSTEM = """You are a document section writer. You write ONE section of a larger document.
You receive: the global outline, your specific section requirements, the previous section's ending (for continuity),
and the next section's topic (for transition). You also receive relevant source materials and visual instructions.

Rules:
1. Write ONLY the content for your assigned section. Do not include the heading — it will be added automatically.
2. Hit the target word count (±10%). If the target is 500 words, write 450-550 words.
3. Cover ALL points listed in must_cover.
4. Reference the provided source materials naturally.
5. Maintain continuity with the previous section's ending.
6. End with a smooth transition toward the next section's topic.
7. If visual instructions say to include a Mermaid diagram, include it as a fenced ```mermaid code block.
8. If visual instructions reference an image URL, include it as ![description](url).
"""


def build_section_context(
    *,
    section: SectionPlan,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None,
    prev_section_tail: str = "",
    next_section_header: str = "",
    section_index: int = 0,
    total_sections: int = 1,
) -> str:
    """Build the context package for writing one section."""
    parts = []

    # Global info
    parts.append(f"[Document Title] {blueprint.title}")
    parts.append(f"[Target Audience] {brief.audience}")
    parts.append(f"[Writing Style] {brief.style}")
    parts.append(f"[Section {section_index + 1} of {total_sections}]")

    # Global outline (all section titles for positioning)
    outline_lines = []
    for i, s in enumerate(blueprint.sections):
        marker = ">>> " if s.id == section.id else "    "
        outline_lines.append(f"{marker}{'#' * s.level} {s.title}")
    parts.append(f"\n[Global Outline]\n" + "\n".join(outline_lines))

    # Previous section tail (for continuity)
    if prev_section_tail:
        parts.append(f"\n[Previous Section Ending]\n{prev_section_tail}")

    # Next section header (for transition)
    if next_section_header:
        parts.append(f"\n[Next Section Topic] {next_section_header}")

    # Current section requirements
    parts.append(f"\n[Your Section] {section.title}")
    parts.append(f"[Target Word Count] {section.word_budget} words (±10%)")
    parts.append(f"[Section Goal] {section.description}")

    if section.must_cover:
        parts.append("[Must Cover]\n" + "\n".join(f"- {point}" for point in section.must_cover))

    # Relevant assets (only those referenced by this section)
    if asset_map and section.assets:
        relevant = [item for item in asset_map.items if item.id in section.assets]
        if relevant:
            parts.append("\n[Source Materials]")
            for item in relevant:
                parts.append(f"--- {item.type}: {item.id} ---")
                if item.type == "image":
                    parts.append(f"Image URL: {item.content}")
                    parts.append(f"Description: {item.summary}")
                else:
                    content_preview = item.content[:2000] if len(item.content) > 2000 else item.content
                    parts.append(content_preview)

    # Visual instructions
    if section.visuals:
        parts.append("\n[Visual Instructions]")
        for v in section.visuals:
            if v.type == "mermaid":
                parts.append(f"- Include a Mermaid {v.description} diagram")
            elif v.type == "reuse_image" and v.source_asset_id:
                # Find the image URL from assets
                if asset_map:
                    img = next((i for i in asset_map.items if i.id == v.source_asset_id), None)
                    if img:
                        parts.append(f"- Include image: ![{v.description}]({img.content})")
            elif v.type == "ai_image":
                parts.append(f"- [AI will generate: {v.description}]")
            elif v.type == "table":
                parts.append(f"- Include a table: {v.description}")

    return "\n".join(parts)


def get_prev_section_tail(drafts: list[SectionDraft], current_index: int, max_chars: int = 500) -> str:
    """Get the last paragraph(s) of the previous section for continuity."""
    if current_index <= 0 or not drafts:
        return ""
    prev = drafts[current_index - 1] if current_index - 1 < len(drafts) else None
    if not prev or not prev.content:
        return ""
    paragraphs = prev.content.strip().split("\n\n")
    tail = paragraphs[-1] if paragraphs else ""
    if len(tail) > max_chars:
        tail = tail[-max_chars:]
    return tail


def get_next_section_header(blueprint: CreationBlueprint, current_index: int) -> str:
    """Get the title and goal of the next section for transition."""
    if current_index >= len(blueprint.sections) - 1:
        return ""
    next_section = blueprint.sections[current_index + 1]
    return f"{next_section.title}: {next_section.description}"


async def generate_section_visuals(
    section: SectionPlan,
    asset_map: AssetMap | None,
    thread_id: str = "",
    page_id: str | None = None,
) -> list[str]:
    """Generate visual assets for a section (AI images only — mermaid is inline).

    Returns list of generated image URLs.
    """
    generated_urls = []
    for visual in section.visuals:
        if visual.type == "ai_image":
            try:
                # Use existing image generation tool
                from app.tools.nanobana_imggen import nanobana_imggen
                result = nanobana_imggen.invoke({"prompt": visual.description})

                if result and page_id:
                    # Upload to Docmost
                    from app.tools.docmost_api import docmost_upload
                    url = docmost_upload.invoke({
                        "file_content_b64": result,
                        "filename": f"generated_{visual.description[:20]}.png",
                        "page_id": page_id,
                    })
                    generated_urls.append(url)
                    await emit(thread_id, {"type": "image", "url": url, "description": visual.description})
            except Exception as e:
                await emit(thread_id, {"type": "step_done", "step": "image_generation", "result_summary": f"Failed: {str(e)[:100]}"})

    return generated_urls


async def write_section(
    *,
    section: SectionPlan,
    blueprint: CreationBlueprint,
    brief: CreationBrief,
    asset_map: AssetMap | None = None,
    prev_section_tail: str = "",
    next_section_header: str = "",
    section_index: int = 0,
    total_sections: int = 1,
    thread_id: str = "",
    max_retries: int = 1,
) -> SectionDraft:
    """Write a single section with word budget enforcement."""
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
    )

    model = create_pydantic_ai_model()
    agent = Agent(model, system_prompt=SECTION_WRITER_SYSTEM)

    wc = 0
    full_text = ""

    for attempt in range(1 + max_retries):
        prompt = context
        if attempt > 0:
            prompt += f"\n\n[RETRY] Your previous attempt had {wc} words but the target is {section.word_budget}. Please write closer to {section.word_budget} words."

        # Stream content
        full_text = ""
        await emit(thread_id, {"type": "step_start", "step": f"write_section_{section.id}", "description": f"Writing: {section.title}"})

        async with agent.run_stream(prompt) as result:
            async for chunk in result.stream_text(delta=True):
                full_text += chunk
                await emit(thread_id, {"type": "content", "chunk": chunk, "section_id": section.id})

        wc = count_words(full_text)
        budget = section.word_budget
        compliance = wc / budget if budget > 0 else 1.0

        await emit(thread_id, {"type": "step_done", "step": f"write_section_{section.id}", "result_summary": f"{wc} words (target: {budget})"})

        # Check word budget (±10% tolerance → 80% is retry threshold)
        if budget > 0 and wc < budget * 0.8 and attempt < max_retries:
            continue  # Retry

        break

    budget = section.word_budget
    compliance = wc / budget if budget > 0 else 1.0

    return SectionDraft(
        section_id=section.id,
        content=full_text,
        word_count=wc,
        budget_compliance=compliance,
        assets_used=[a for a in section.assets if asset_map and any(i.id == a for i in asset_map.items)],
    )
