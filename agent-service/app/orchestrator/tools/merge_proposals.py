"""Generate merge proposals for multi-document scenarios.

When a user uploads multiple documents, the system proposes 2-3 ways
to combine them into a single document.
"""
from __future__ import annotations
import json
import re
from pydantic_ai import Agent
from app.models.asset_map import AssetMap
from app.orchestrator.llm_factory import create_pydantic_ai_model
from app.agent.events import emit


class MergeProposal:
    def __init__(self, title: str, description: str, structure: list[dict]):
        self.title = title
        self.description = description
        self.structure = structure  # [{level, title, source_doc}]

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "description": self.description,
            "structure": self.structure,
        }


def _summarize_sources(asset_map: AssetMap) -> str:
    """Summarize source documents from an AssetMap."""
    sources_by_file: dict[str, dict] = {}
    for item in asset_map.items:
        if item.source not in sources_by_file:
            sources_by_file[item.source] = {"headings": [], "word_count": 0}
        if item.type == "heading_structure":
            sources_by_file[item.source]["headings"].append(item.content)
        if item.type == "text":
            sources_by_file[item.source]["word_count"] += len(item.content)

    return "\n".join(
        f"- {name}: {info['word_count']} chars, headings: {'; '.join(info['headings'][:3])}"
        for name, info in sources_by_file.items()
    )


async def generate_merge_proposals(
    asset_map: AssetMap,
    user_message: str,
    thread_id: str = "",
) -> list[MergeProposal]:
    """Generate 2-3 merge proposals for multi-document input."""
    sources_summary = _summarize_sources(asset_map)

    model = create_pydantic_ai_model()
    agent = Agent(model, system_prompt="Generate document merge proposals. Output JSON only.")

    prompt = f"""Given these source documents, propose 2-3 ways to merge them into a single document.

User request: {user_message}

Source documents:
{sources_summary}

Output JSON array:
[{{"title": "Proposal name", "description": "Brief explanation", "structure": [{{"level": 2, "title": "Section name", "source_doc": "filename or 'new'"}}]}}]"""

    await emit(thread_id, {"type": "step_start", "step": "merge_proposals", "description": "生成合并方案"})

    result = await agent.run(prompt)
    text = result.data if hasattr(result, 'data') else str(result)

    try:
        json_match = re.search(r'\[.*\]', text, re.DOTALL)
        proposals_data = json.loads(json_match.group()) if json_match else []
    except (json.JSONDecodeError, AttributeError):
        proposals_data = []

    proposals = [
        MergeProposal(
            title=p.get("title", f"方案 {i+1}"),
            description=p.get("description", ""),
            structure=p.get("structure", []),
        )
        for i, p in enumerate(proposals_data[:3])
    ]

    await emit(thread_id, {"type": "step_done", "step": "merge_proposals", "result_summary": f"{len(proposals)} 个方案"})

    return proposals
