"""create_brief orchestrator tool — Smart Brief generation via LLM.

Analyzes the user prompt, asset map, page content, and template context
to produce a CreationBrief with AI-recommended defaults for audience,
goal, length, style, tone, and structural strategy.
"""
from __future__ import annotations

import json
import re

from app.agent.events import emit  # imported at module level so tests can patch it
from app.models.asset_map import AssetMap
from app.models.brief import CreationBrief


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _summarize_asset_map(asset_map: AssetMap) -> str:
    """Build a concise text summary of an AssetMap for inclusion in a prompt."""
    if not asset_map.items:
        return "(no assets)"

    lines: list[str] = [
        f"Source word count: {asset_map.source_word_count}",
    ]

    # Type counts
    type_counts: dict[str, int] = {}
    for item in asset_map.items:
        type_counts[item.type] = type_counts.get(item.type, 0) + 1
    if type_counts:
        counts_str = ", ".join(f"{t}: {n}" for t, n in sorted(type_counts.items()))
        lines.append(f"Asset types: {counts_str}")

    # Heading structure
    heading_items = asset_map.items_by_type("heading_structure")
    if heading_items:
        try:
            headings = json.loads(heading_items[0].content)
            heading_texts = [h["text"] for h in headings[:6]]
            lines.append(f"Document headings: {', '.join(heading_texts)}")
        except (json.JSONDecodeError, KeyError):
            pass

    return "\n".join(lines)


def build_brief_prompt(
    user_message: str,
    asset_map: AssetMap | None,
    page_content: str | None,
    template_prompt: str | None,
) -> str:
    """Build the LLM prompt for Smart Brief generation.

    Args:
        user_message: The user's natural language creation request.
        asset_map: Optional parsed assets from uploaded documents.
        page_content: Optional existing page content for context.
        template_prompt: Optional template instructions.

    Returns:
        A formatted prompt string ready to send to the LLM.
    """
    parts: list[str] = []

    parts.append(
        "You are a document planning assistant. Analyze the user request and "
        "any provided context, then output a JSON object describing the optimal "
        "document creation parameters."
    )

    if template_prompt:
        parts.append(f"[Template Instructions]\n{template_prompt.strip()}")

    parts.append(f"[User Request]\n{user_message.strip()}")

    if asset_map and asset_map.items:
        parts.append(f"[Source Material Summary]\n{_summarize_asset_map(asset_map)}")

    if page_content:
        snippet = page_content.strip()[:600]
        parts.append(f"[Existing Page Content (excerpt)]\n{snippet}")

    parts.append(
        """Output a JSON object with these fields (all optional, use empty string/"" for unknown):
{
  "audience": "<target audience>",
  "goal": "<document goal>",
  "target_length": <integer, 0 if unknown>,
  "style": "<writing style>",
  "tone": "<tone>",
  "structure_strategy": "<copy_source|ai_recommend|user_defined>",
  "image_strategy": "<reuse_source|generate_new|mixed|none>",
  "constraints": ["<constraint1>", ...]
}

Rules:
- target_length counting: for Chinese text, each Chinese character (字) counts as 1; for English text, each word counts as 1. For example, "用户登录系统" = 6, "user login system" = 3.
- structure_strategy = "copy_source" when the user wants to reproduce or adapt an existing document.
- structure_strategy = "user_defined" when the user explicitly described the structure.
- Otherwise use "ai_recommend".
- image_strategy = "reuse_source" when source material has images and user wants them kept.
- image_strategy = "none" when no images are requested.
- target_length: estimate based on the request. If reproducing a source document, use its character/word count.
- Respond with ONLY the JSON object, no explanation."""
    )

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# LLM call with JSON extraction
# ---------------------------------------------------------------------------

async def _call_llm_for_brief(prompt: str) -> dict:
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
# Public API
# ---------------------------------------------------------------------------

async def generate_brief(
    user_message: str,
    asset_map: AssetMap | None,
    page_content: str | None,
    template_prompt: str | None,
    thread_id: str,
) -> CreationBrief:
    """Generate a Smart Brief using LLM analysis.

    Analyzes user prompt + assets to produce a CreationBrief with
    AI-recommended defaults for audience, goal, length, style, tone, etc.

    Special rule: when ``asset_map.source_word_count > 0``, the brief's
    ``target_length`` is seeded from the source word count (copy-source mode).
    The LLM may override this via its JSON response.

    Args:
        user_message: The user's natural language creation request.
        asset_map: Optional AssetMap from previously parsed documents.
        page_content: Optional current page content for context.
        template_prompt: Optional template instructions.
        thread_id: SSE thread ID (for future event emission; unused in this step).

    Returns:
        A populated :class:`~app.models.brief.CreationBrief`.
    """
    await emit(
        thread_id,
        {
            "type": "step_start",
            "step": "generate_brief",
            "description": "Generating Smart Brief…",
        },
    )

    # Build prompt
    prompt = build_brief_prompt(
        user_message=user_message,
        asset_map=asset_map,
        page_content=page_content,
        template_prompt=template_prompt,
    )

    # Call LLM
    llm_data = await _call_llm_for_brief(prompt)

    # Seed target_length from source_word_count if available
    source_wc = asset_map.source_word_count if asset_map else 0
    if source_wc > 0 and "target_length" not in llm_data:
        llm_data["target_length"] = source_wc

    # Build CreationBrief from LLM response, with safe defaults
    brief_kwargs: dict = {}

    if llm_data.get("audience"):
        brief_kwargs["audience"] = str(llm_data["audience"])
    if llm_data.get("goal"):
        brief_kwargs["goal"] = str(llm_data["goal"])
    if llm_data.get("target_length"):
        try:
            brief_kwargs["target_length"] = int(llm_data["target_length"])
        except (TypeError, ValueError):
            pass
    if llm_data.get("style"):
        brief_kwargs["style"] = str(llm_data["style"])
    if llm_data.get("tone"):
        brief_kwargs["tone"] = str(llm_data["tone"])
    if llm_data.get("structure_strategy") in ("copy_source", "ai_recommend", "user_defined"):
        brief_kwargs["structure_strategy"] = llm_data["structure_strategy"]
    if llm_data.get("image_strategy") in ("reuse_source", "generate_new", "mixed", "none"):
        brief_kwargs["image_strategy"] = llm_data["image_strategy"]
    if isinstance(llm_data.get("constraints"), list):
        brief_kwargs["constraints"] = [str(c) for c in llm_data["constraints"]]

    brief = CreationBrief(**brief_kwargs)

    await emit(
        thread_id,
        {
            "type": "step_done",
            "step": "generate_brief",
            "result_summary": (
                f"Brief generated: audience='{brief.audience}', "
                f"target_length={brief.target_length}"
            ),
        },
    )

    return brief
