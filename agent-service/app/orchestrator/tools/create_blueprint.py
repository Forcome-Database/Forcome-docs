"""CreationBlueprint generation via LLM."""
from __future__ import annotations

import json
import re

from app.agent.events import emit
from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan, VisualPlan
from app.models.brief import CreationBrief
from app.workers.visual_planner import plan_visuals


def _summarize_brief(brief: CreationBrief) -> str:
    parts: list[str] = []
    if brief.audience:
        parts.append(f"Audience: {brief.audience}")
    if brief.goal:
        parts.append(f"Goal: {brief.goal}")
    if brief.target_length:
        parts.append(f"Target length: {brief.target_length} characters/words")
    if brief.style:
        parts.append(f"Style: {brief.style}")
    if brief.tone:
        parts.append(f"Tone: {brief.tone}")
    parts.append(f"Structure strategy: {brief.structure_strategy}")
    parts.append(f"Image strategy: {brief.image_strategy}")
    if brief.constraints:
        parts.append(f"Constraints: {', '.join(brief.constraints)}")
    return "\n".join(parts) if parts else "(no brief details)"


def _summarize_assets_for_blueprint(asset_map: AssetMap) -> str:
    if not asset_map.items:
        return "(no assets)"

    lines: list[str] = []
    by_type: dict[str, list] = {}
    for item in asset_map.items:
        by_type.setdefault(item.type, []).append(item)

    for asset_type, items in sorted(by_type.items()):
        lines.append(f"\n[{asset_type.upper()} assets]")
        for item in items[:8]:
            summary = item.summary or item.content[:120]
            lines.append(f"  - id={item.id}: {summary[:120]}")

    return "\n".join(lines)


def _source_structure_hint(asset_map: AssetMap) -> str:
    if not asset_map.source_structure:
        return ""
    headings = asset_map.source_structure[:12]
    lines = ["Source document headings (copy_source mode should broadly match this structure):"]
    for heading in headings:
        level = int(heading.get("level", 1))
        text = str(heading.get("text") or heading.get("title") or "")
        indent = "  " * max(level - 1, 0)
        lines.append(f"{indent}{'#' * level} {text}")
    return "\n".join(lines)


def build_blueprint_prompt(
    user_message: str,
    brief: CreationBrief,
    asset_map: AssetMap | None,
) -> str:
    parts: list[str] = []
    parts.append(
        "You are a document structure planner. Based on the user request, "
        "Smart Brief, and available assets, output a JSON blueprint with "
        "document sections, word budgets, asset assignments, and visual planning."
    )
    parts.append(f"[User Request]\n{user_message.strip()}")
    parts.append(f"[Smart Brief]\n{_summarize_brief(brief)}")

    if asset_map and asset_map.items:
        parts.append(f"[Available Assets]\n{_summarize_assets_for_blueprint(asset_map)}")
        if brief.structure_strategy == "copy_source" and asset_map.source_structure:
            parts.append(_source_structure_hint(asset_map))

    total_budget = brief.target_length or 800
    asset_ids_hint = ""
    if asset_map and asset_map.items:
        sample_ids = [item.id for item in asset_map.items[:12]]
        asset_ids_hint = f"\nAvailable asset IDs you may assign to sections: {sample_ids}"

    parts.append(
        f"""Output a JSON object with this exact structure:
{{
  "title": "<document title>",
  "total_word_budget": {total_budget},
  "style_guide": "<short writing guidance for the full document>",
  "visual_plan_summary": "<summary of why visuals are used or not used>",
  "sections": [
    {{
      "id": "s1",
      "title": "<section title>",
      "level": <1|2|3>,
      "word_budget": <integer>,
      "description": "<what this section covers>",
      "assets": ["<asset_id>", ...],
      "visuals": [
        {{
          "type": "<mermaid|ai_image|reuse_image|table>",
          "description": "<what the visual should show>",
          "source_asset_id": "<asset id or null>",
          "position": "<before_section|after_paragraph|end_of_section>"
        }}
      ],
      "must_cover": ["<key point 1>", "<key point 2>"]
    }}
  ]
}}

Rules:
- Count Chinese by characters and English by words.
- The sum of all section word_budgets MUST be close to total_word_budget ({total_budget}, +/-10%).
- Each section id must be unique (s1, s2, s3, ...).
- Use level=2 for main sections, level=3 for subsections. Do NOT use level=1.
- If image_strategy is "none", keep visuals empty and explain that in visual_plan_summary.
- Prefer reuse_image when source assets already contain a relevant image.
- If image_strategy is "generate_new" or "mixed", add ai_image visuals where illustrations would materially improve comprehension.
- Only include asset IDs from the available assets list.{asset_ids_hint}
- Respond with ONLY the JSON object, no explanation."""
    )

    return "\n\n".join(parts)


async def _call_llm_for_blueprint(prompt: str) -> dict:
    from pydantic_ai import Agent
    from app.orchestrator.llm_factory import create_pydantic_ai_model

    model = create_pydantic_ai_model()
    agent: Agent[None, str] = Agent(model=model, output_type=str)
    result = await agent.run(prompt)
    raw: str = result.output if hasattr(result, "output") else str(result)

    json_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not json_match:
        return {}

    try:
        return json.loads(json_match.group(0))
    except json.JSONDecodeError:
        return {}


def _normalize_word_budgets(blueprint: CreationBlueprint) -> CreationBlueprint:
    if not blueprint.sections or blueprint.total_word_budget <= 0:
        return blueprint

    section_total = sum(section.word_budget for section in blueprint.sections)
    if section_total == 0:
        per_section = blueprint.total_word_budget // len(blueprint.sections)
        remainder = blueprint.total_word_budget - per_section * len(blueprint.sections)
        for index, section in enumerate(blueprint.sections):
            section.word_budget = per_section + (1 if index < remainder else 0)
        return blueprint

    ratio = section_total / blueprint.total_word_budget
    if 0.9 <= ratio <= 1.1:
        return blueprint

    scale = blueprint.total_word_budget / section_total
    adjusted_total = 0
    for section in blueprint.sections[:-1]:
        new_budget = max(1, round(section.word_budget * scale))
        section.word_budget = new_budget
        adjusted_total += new_budget

    blueprint.sections[-1].word_budget = max(1, blueprint.total_word_budget - adjusted_total)
    return blueprint


def _parse_visuals(raw_visuals: object) -> list[VisualPlan]:
    if not isinstance(raw_visuals, list):
        return []

    visuals: list[VisualPlan] = []
    for raw_visual in raw_visuals:
        if not isinstance(raw_visual, dict):
            continue
        try:
            visuals.append(
                VisualPlan(
                    type=str(raw_visual.get("type", "table")),
                    description=str(raw_visual.get("description", "")),
                    source_asset_id=raw_visual.get("source_asset_id"),
                    position=str(raw_visual.get("position", "end_of_section")),
                )
            )
        except (TypeError, ValueError):
            continue
    return visuals


async def generate_blueprint(
    user_message: str,
    brief: CreationBrief,
    asset_map: AssetMap | None,
    thread_id: str,
) -> CreationBlueprint:
    await emit(
        thread_id,
        {
            "type": "step_start",
            "step": "generate_blueprint",
            "description": "Generating document blueprint...",
        },
    )

    llm_data = await _call_llm_for_blueprint(
        build_blueprint_prompt(user_message=user_message, brief=brief, asset_map=asset_map)
    )

    sections: list[SectionPlan] = []
    raw_sections = llm_data.get("sections", [])
    if isinstance(raw_sections, list):
        for index, raw_section in enumerate(raw_sections):
            if not isinstance(raw_section, dict):
                continue
            try:
                sections.append(
                    SectionPlan(
                        id=str(raw_section.get("id", f"s{index + 1}")),
                        title=str(raw_section.get("title", f"Section {index + 1}")),
                        level=int(raw_section.get("level", 2)),
                        word_budget=int(raw_section.get("word_budget", 0)),
                        description=str(raw_section.get("description", "")),
                        assets=list(raw_section.get("assets", [])),
                        visuals=_parse_visuals(raw_section.get("visuals", [])),
                        must_cover=list(raw_section.get("must_cover", [])),
                    )
                )
            except (TypeError, ValueError):
                continue

    total_budget = brief.target_length or 800
    try:
        llm_budget = int(llm_data.get("total_word_budget", 0))
        if llm_budget > 0:
            total_budget = llm_budget
    except (TypeError, ValueError):
        pass

    title = str(llm_data.get("title", "")) or user_message[:60]
    style_guide = str(llm_data.get("style_guide", "") or brief.style or "")

    sections = plan_visuals(sections, asset_map, brief)
    if brief.image_strategy in {"generate_new", "mixed"} and not any(
        any(visual.type == "ai_image" for visual in section.visuals)
        for section in sections
    ) and sections:
        sections[0].visuals.append(
            VisualPlan(
                type="ai_image",
                description=f"Illustration for {sections[0].title}",
                position="before_section",
            )
        )
    visual_plan_summary = str(llm_data.get("visual_plan_summary", "") or "")
    if not visual_plan_summary:
        visual_count = sum(len(section.visuals) for section in sections)
        visual_plan_summary = (
            "No visuals planned."
            if visual_count == 0
            else f"{visual_count} visuals planned across {len(sections)} sections."
        )

    blueprint = CreationBlueprint(
        title=title,
        sections=sections,
        total_word_budget=total_budget,
        style_guide=style_guide,
        visual_plan_summary=visual_plan_summary,
    )
    blueprint = _normalize_word_budgets(blueprint)

    await emit(
        thread_id,
        {
            "type": "step_done",
            "step": "generate_blueprint",
            "result_summary": (
                f"Blueprint generated: {len(blueprint.sections)} sections, "
                f"{blueprint.total_word_budget} total words"
            ),
        },
    )

    return blueprint
