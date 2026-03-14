"""create_blueprint orchestrator tool — CreationBlueprint generation via LLM.

Analyzes the user prompt, Smart Brief, and asset map to produce a
CreationBlueprint with section plans, word budgets, and visual hints.
"""
from __future__ import annotations

import json
import re

from app.agent.events import emit  # imported at module level so tests can patch it
from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.brief import CreationBrief


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _summarize_brief(brief: CreationBrief) -> str:
    """Build a concise text summary of a CreationBrief for inclusion in a prompt."""
    parts: list[str] = []
    if brief.audience:
        parts.append(f"Audience: {brief.audience}")
    if brief.goal:
        parts.append(f"Goal: {brief.goal}")
    if brief.target_length:
        parts.append(f"Target length: {brief.target_length} words")
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
    """Build a summary of AssetMap items (by type) for the blueprint prompt."""
    if not asset_map.items:
        return "(no assets)"

    lines: list[str] = []

    # Group items by type and list summaries
    by_type: dict[str, list] = {}
    for item in asset_map.items:
        by_type.setdefault(item.type, []).append(item)

    for asset_type, items in sorted(by_type.items()):
        lines.append(f"\n[{asset_type.upper()} assets]")
        for item in items[:8]:  # cap at 8 per type to avoid prompt bloat
            lines.append(f"  - id={item.id}: {item.summary[:120]}")

    return "\n".join(lines)


def _source_structure_hint(asset_map: AssetMap) -> str:
    """Build a hint about the source document's heading structure."""
    if not asset_map.source_structure:
        return ""
    headings = asset_map.source_structure[:12]
    lines = ["Source document headings (copy_source mode — match this structure):"]
    for h in headings:
        indent = "  " * (h.get("level", 1) - 1)
        lines.append(f"{indent}{'#' * h.get('level', 1)} {h.get('text', '')}")
    return "\n".join(lines)


def build_blueprint_prompt(
    user_message: str,
    brief: CreationBrief,
    asset_map: AssetMap | None,
) -> str:
    """Build the LLM prompt for Blueprint generation.

    Args:
        user_message: The user's natural language creation request.
        brief: The pre-generated Smart Brief.
        asset_map: Optional parsed assets from uploaded documents.

    Returns:
        A formatted prompt string ready to send to the LLM.
    """
    parts: list[str] = []

    parts.append(
        "You are a document structure planner. Based on the user request, "
        "Smart Brief, and available assets, output a JSON blueprint with "
        "document sections, word budgets, and asset assignments."
    )

    parts.append(f"[User Request]\n{user_message.strip()}")
    parts.append(f"[Smart Brief]\n{_summarize_brief(brief)}")

    if asset_map and asset_map.items:
        parts.append(f"[Available Assets]\n{_summarize_assets_for_blueprint(asset_map)}")

        # If copy_source strategy, provide source structure hint
        if brief.structure_strategy == "copy_source" and asset_map.source_structure:
            parts.append(_source_structure_hint(asset_map))

    total_budget = brief.target_length or 800  # fallback default

    # Asset IDs to reference
    asset_ids_hint = ""
    if asset_map and asset_map.items:
        sample_ids = [item.id for item in asset_map.items[:10]]
        asset_ids_hint = (
            f"\nAvailable asset IDs you may assign to sections: {sample_ids}"
        )

    parts.append(
        f"""Output a JSON object with this exact structure:
{{
  "title": "<document title>",
  "total_word_budget": {total_budget},
  "sections": [
    {{
      "id": "s1",
      "title": "<section title>",
      "level": <1|2|3>,
      "word_budget": <integer>,
      "description": "<what this section covers>",
      "assets": ["<asset_id>", ...],
      "must_cover": ["<key point 1>", "<key point 2>"]
    }}
  ]
}}

Rules:
- The sum of all section word_budgets MUST be close to total_word_budget ({total_budget} words, ±10%).
- Each section id must be unique (s1, s2, s3, ...).
- Use level=1 for the document title/intro, level=2 for main sections, level=3 for subsections.
- Only include asset IDs from the available assets list.{asset_ids_hint}
- Respond with ONLY the JSON object, no explanation."""
    )

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# LLM call with JSON extraction
# ---------------------------------------------------------------------------

async def _call_llm_for_blueprint(prompt: str) -> dict:
    """Call the configured LLM and extract a JSON dict from its response.

    Returns a dict (possibly empty) parsed from the LLM output.
    """
    from pydantic_ai import Agent
    from app.orchestrator.llm_factory import create_pydantic_ai_model

    model = create_pydantic_ai_model()
    agent: Agent[None, str] = Agent(model=model, output_type=str)

    result = await agent.run(prompt)
    raw: str = result.output if hasattr(result, "output") else str(result)

    # Extract JSON object from the response (it may be wrapped in ```json ... ```)
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not json_match:
        return {}

    try:
        return json.loads(json_match.group(0))
    except json.JSONDecodeError:
        return {}


# ---------------------------------------------------------------------------
# Word budget normalization
# ---------------------------------------------------------------------------

def _normalize_word_budgets(blueprint: CreationBlueprint) -> CreationBlueprint:
    """Normalize section word_budgets so they sum to total_word_budget (±10%).

    If sections are missing budgets or the total is off by more than 10%,
    redistribute proportionally.

    Args:
        blueprint: The blueprint to normalize (mutated in-place).

    Returns:
        The same blueprint with normalized budgets.
    """
    if not blueprint.sections or blueprint.total_word_budget <= 0:
        return blueprint

    section_total = sum(s.word_budget for s in blueprint.sections)

    # Check if normalization is needed
    if section_total == 0:
        # Distribute evenly
        per_section = blueprint.total_word_budget // len(blueprint.sections)
        remainder = blueprint.total_word_budget - per_section * len(blueprint.sections)
        for i, section in enumerate(blueprint.sections):
            section.word_budget = per_section + (1 if i < remainder else 0)
        return blueprint

    ratio = section_total / blueprint.total_word_budget
    if 0.9 <= ratio <= 1.1:
        # Within tolerance — no action needed
        return blueprint

    # Scale proportionally
    scale = blueprint.total_word_budget / section_total
    adjusted_total = 0
    for i, section in enumerate(blueprint.sections[:-1]):
        new_budget = max(1, round(section.word_budget * scale))
        section.word_budget = new_budget
        adjusted_total += new_budget

    # Assign remainder to last section to hit exact total
    blueprint.sections[-1].word_budget = max(
        1, blueprint.total_word_budget - adjusted_total
    )

    return blueprint


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_blueprint(
    user_message: str,
    brief: CreationBrief,
    asset_map: AssetMap | None,
    thread_id: str,
) -> CreationBlueprint:
    """Generate a CreationBlueprint using LLM analysis.

    Produces a structured blueprint with section plans, word budgets, and
    asset assignments based on the user request, brief, and available assets.

    Special rule: if brief.structure_strategy == "copy_source" and asset_map
    has source_structure, the prompt instructs the LLM to match the source
    heading structure.

    Args:
        user_message: The user's natural language creation request.
        brief: Pre-generated Smart Brief with audience, goal, length, etc.
        asset_map: Optional AssetMap from previously parsed documents.
        thread_id: SSE thread ID for event emission.

    Returns:
        A populated :class:`~app.models.blueprint.CreationBlueprint`.
    """
    await emit(
        thread_id,
        {
            "type": "step_start",
            "step": "generate_blueprint",
            "description": "Generating document blueprint…",
        },
    )

    # Build prompt
    prompt = build_blueprint_prompt(
        user_message=user_message,
        brief=brief,
        asset_map=asset_map,
    )

    # Call LLM
    llm_data = await _call_llm_for_blueprint(prompt)

    # Parse sections
    sections: list[SectionPlan] = []
    raw_sections = llm_data.get("sections", [])
    if isinstance(raw_sections, list):
        for i, raw_sec in enumerate(raw_sections):
            if not isinstance(raw_sec, dict):
                continue
            try:
                section = SectionPlan(
                    id=str(raw_sec.get("id", f"s{i + 1}")),
                    title=str(raw_sec.get("title", f"Section {i + 1}")),
                    level=int(raw_sec.get("level", 2)),
                    word_budget=int(raw_sec.get("word_budget", 0)),
                    description=str(raw_sec.get("description", "")),
                    assets=list(raw_sec.get("assets", [])),
                    must_cover=list(raw_sec.get("must_cover", [])),
                )
                sections.append(section)
            except (TypeError, ValueError):
                continue

    # Parse total_word_budget
    total_budget = brief.target_length or 800
    try:
        llm_budget = int(llm_data.get("total_word_budget", 0))
        if llm_budget > 0:
            total_budget = llm_budget
    except (TypeError, ValueError):
        pass

    # Parse title
    title = str(llm_data.get("title", "")) or user_message[:60]

    blueprint = CreationBlueprint(
        title=title,
        sections=sections,
        total_word_budget=total_budget,
    )

    # Normalize word budgets
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
