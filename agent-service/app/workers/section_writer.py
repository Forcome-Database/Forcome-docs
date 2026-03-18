"""SectionWriter Worker — generates one document section at a time.

Uses a carefully crafted context package to maintain coherence across sections.
Enforces word budget with a retry mechanism.
"""
from __future__ import annotations
import asyncio
import re
from app.models.blueprint import SectionPlan, CreationBlueprint
from app.models.draft import SectionDraft
from app.models.document_tree import build_section_node_id
from app.models.asset_map import AssetMap, AssetItem
from app.models.brief import CreationBrief
from app.utils.text import count_words
from app.agent.events import emit
from app.orchestrator.llm_factory import create_pydantic_ai_model

ASSET_MARKER_RE = r"<!--asset:([a-zA-Z0-9_-]+)-->"


SECTION_WRITER_SYSTEM = """You are a professional document section writer. You write ONE section of a larger document using rich Markdown formatting.
You receive: the global outline, your specific section requirements, the previous section's ending (for continuity),
and the next section's topic (for transition). You also receive relevant source materials and visual instructions.

Rules:
1. Write ONLY the content for your assigned section. Do NOT include the section's main heading — it will be added automatically.
2. Hit the target character/word count (±10%). IMPORTANT: For Chinese text, each Chinese character (字) counts as 1. For English text, each word counts as 1. If the target is 200, write approximately 180-220 characters/words.
3. Cover ALL points listed in must_cover.
4. Reference the provided source materials naturally.
5. Maintain continuity with the previous section's ending.
6. End with a smooth transition toward the next section's topic.
7. If visual instructions say to include a Mermaid diagram, include it as a fenced ```mermaid code block.
8. If visual instructions reference an image URL, include it as ![description](url).
9. When you materially use a provided source asset, include its marker exactly once near the first relevant paragraph, for example <!--asset:asset_id-->.

Formatting requirements (IMPORTANT — use rich Markdown):
- Use sub-headings (###, ####) to organize content within the section when appropriate.
- Use bullet lists (- item) or numbered lists (1. item) for enumerations, features, steps, or requirements.
- Use **bold** for key terms, important concepts, and field names.
- Use `code` for technical terms, API names, field names, and variable names.
- Use fenced code blocks (```language) for code snippets, configuration examples, or command-line instructions.
- Use tables (| col1 | col2 |) for comparisons, specifications, or structured data.
- Use > blockquotes for important notes, warnings, or callouts.
- Do NOT output plain prose paragraphs only. Structure the content for easy scanning and comprehension.

Writing style (anti-AI boilerplate):
- Default to Chinese output unless the user explicitly requests another language.
- NEVER use: "首先/其次/最后", "综上所述", "值得注意的是", "总而言之", "让我们".
- Vary paragraph length: mix short paragraphs (1-2 sentences) with longer ones (4-6 sentences).
- Diversify sentence patterns: alternate between statements, rhetorical questions, and reflective questions.
- Replace abstract descriptions with specific data, real-world examples, and operational details.
- Write like an experienced professional having a conversation — NOT like an AI listing bullet points.
- Avoid buzzwords: "赋能", "抓手", "落地", "闭环", "链路", "沉淀", "对齐".
- Headings can use questions or verb phrases — do NOT default to "xxx的xxx" noun-phrase format.
CRITICAL: Do NOT exceed the target length by more than 10%.
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
    user_message: str = "",
    system_prompt: str = "",
    template_prompt: str = "",
    intent_route: str = "document_create",
    generated_image_urls: list[str] | None = None,
) -> str:
    """Build the context package for writing one section."""
    parts = []

    # User's original request (critical for maintaining intent)
    if user_message:
        parts.append(f"[User's Original Request] {user_message}")

    # System/template instructions
    if system_prompt:
        parts.append(f"[System Instructions] {system_prompt}")
    if template_prompt:
        parts.append(f"[Template Instructions] {template_prompt}")

    # Global info
    parts.append(f"[Document Title] {blueprint.title}")
    parts.append(f"[Target Audience] {brief.audience}")
    parts.append(f"[Writing Style] {brief.style}")
    if blueprint.style_guide:
        parts.append(f"[Style Guide] {blueprint.style_guide}")
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
    parts.append(f"[Target Length] {section.word_budget} 字/words (±10%) — each Chinese character counts as 1, each English word counts as 1")
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
                parts.append(f"Usage marker: <!--asset:{item.id}-->")

    # Source preservation mode for document_transform
    if intent_route == "document_transform":
        parts.append(
            "\n[IMPORTANT: Source Preservation Mode]\n"
            "This is a document transform task. The source material is your PRIMARY reference.\n"
            "- Preserve ALL factual content, technical details, commands, and links from the source\n"
            "- Only restructure/reformat, do NOT rewrite or omit content\n"
            "- Output length should be at least 70% of the source content"
        )

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

    if generated_image_urls:
        parts.append("\n[Generated Images]")
        for index, url in enumerate(generated_image_urls, start=1):
            parts.append(f"- Include generated image {index}: ![{section.title} visual {index}]({url})")

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
    loop = asyncio.get_event_loop()
    for visual in section.visuals:
        if visual.type == "ai_image":
            try:
                # Use existing image generation tool (sync LangChain Tool — run in executor)
                from app.tools.nanobana_imggen import nanobana_imggen
                result = await loop.run_in_executor(
                    None, nanobana_imggen.invoke, {"prompt": visual.description}
                )

                if result and page_id:
                    # Upload to Docmost (also sync)
                    from app.tools.docmost_api import docmost_upload
                    url = await loop.run_in_executor(
                        None, docmost_upload.invoke, {
                            "file_content_b64": result,
                            "filename": f"generated_{visual.description[:20]}.png",
                            "page_id": page_id,
                        }
                    )
                    generated_urls.append(url)
                    await emit(thread_id, {"type": "image", "url": url, "alt": visual.description})
            except ImportError:
                await emit(thread_id, {"type": "step_done", "step": "image_generation", "result_summary": f"Skipped: image generation tool not available"})
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
    max_retries: int = 2,
    user_message: str = "",
    system_prompt: str = "",
    template_prompt: str = "",
    intent_route: str = "document_create",
    generated_image_urls: list[str] | None = None,
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
        user_message=user_message,
        system_prompt=system_prompt,
        template_prompt=template_prompt,
        intent_route=intent_route,
        generated_image_urls=generated_image_urls,
    )

    model = create_pydantic_ai_model()
    agent = Agent(model, system_prompt=SECTION_WRITER_SYSTEM)

    wc = 0
    full_text = ""

    for attempt in range(1 + max_retries):
        prompt = context
        if attempt > 0:
            if wc < section.word_budget * 0.8:
                prompt += f"\n\n[RETRY] Your previous attempt had {wc} 字/words but the target is {section.word_budget}. Remember: each Chinese character counts as 1. Please write closer to {section.word_budget} 字/words."
            elif wc > section.word_budget * 1.3:
                prompt += f"\n\n[RETRY] You wrote {wc} 字/words but budget is only {section.word_budget}. Please CONDENSE to approximately {section.word_budget} 字/words. Remove redundant details and verbose explanations."

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

        # Retry if under 80% or over 130% of budget
        if budget > 0 and attempt < max_retries:
            if wc < budget * 0.8 or wc > budget * 1.3:
                continue  # Retry

        break

    budget = section.word_budget
    compliance = wc / budget if budget > 0 else 1.0

    assets_used = sorted(set(re.findall(ASSET_MARKER_RE, full_text)))

    return SectionDraft(
        section_id=section.id,
        node_id=build_section_node_id(section.id),
        content=full_text,
        word_count=wc,
        budget_compliance=compliance,
        assets_used=assets_used,
    )
