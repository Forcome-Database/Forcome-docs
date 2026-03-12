"""Planner node: produce a structured document plan before outline generation."""
import json
from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.document_strategy import (
    derive_visual_requirements,
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.events import emit
from app.agent.llm import get_chat_model
from app.agent.state import AgentState


PLANNER_SYSTEM_PROMPT = """You are a document planning assistant.
Your job is to create a structured JSON document plan before any full draft is written.

Return only a JSON object with this shape:
{
  "doc_type": "string",
  "audience": "string",
  "required_artifacts": ["table", "mermaid", "code_block", "image", "callout", "details"],
  "sections": [
    {
      "id": "section-1",
      "title": "Section title",
      "goal": "Why this section exists",
      "artifacts": ["table"],
      "must_cover": ["point 1", "point 2"],
      "evidence": ["uploaded_files", "page_context", "web_search", "knowledge_base"]
    }
  ]
}

Rules:
1. Follow the document strategy.
2. Prefer mermaid for architecture, process, and sequence content.
3. Prefer tables for comparisons, matrices, parameters, and decisions.
4. Prefer images for UI, screenshots, operating steps, or visual reference material.
5. Prefer code_block for commands, code, configuration, APIs, and examples.
6. Avoid empty sections; every section must have a concrete goal.
7. Do not write Markdown prose. Output JSON only.
"""


async def planner_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    llm = get_chat_model()

    await emit(
        tid,
        {
            "type": "step_start",
            "step": "plan_doc",
            "description": "Planning the document structure and artifact usage...",
        },
    )

    strategy = state.get("document_strategy") or {}
    visual_requirements = derive_visual_requirements(state)
    context_parts = [
        f"User request: {state['user_message']}",
        f"Document strategy:\n{format_document_strategy(strategy)}",
    ]

    if visual_requirements:
        context_parts.append(
            f"Inferred priority artifacts from request: {', '.join(visual_requirements)}"
        )
    if state.get("selected_proposal"):
        context_parts.append(
            f"Selected proposal: {json.dumps(state['selected_proposal'], ensure_ascii=False)}"
        )
    if state.get("user_answers"):
        context_parts.append(f"Additional user answers: {state['user_answers']}")
    if state.get("page_title"):
        context_parts.append(f"Current page title: {state['page_title']}")
    if state.get("selected_text"):
        context_parts.append(f"Selected text:\n{state['selected_text'][:1200]}")
    if state.get("parsed_files"):
        file_summaries = [f["filename"] for f in state["parsed_files"]]
        context_parts.append(f"Parsed files: {', '.join(file_summaries)}")
    if state.get("research_results"):
        context_parts.append(
            f"Existing research result count: {len(state['research_results'])}"
        )

    messages = [
        SystemMessage(content=PLANNER_SYSTEM_PROMPT),
        HumanMessage(content="\n\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)

    try:
        raw_plan = json.loads(response.content)
    except json.JSONDecodeError:
        raw_plan = {}

    plan = normalize_document_plan(raw_plan, strategy)
    if visual_requirements:
        merged = list(dict.fromkeys(plan["required_artifacts"] + visual_requirements))
        plan["required_artifacts"] = merged

    await emit(
        tid,
        {
            "type": "step_done",
            "step": "plan_doc",
            "result_summary": f"Planned {len(plan['sections'])} sections and {len(plan['required_artifacts'])} required artifacts",
        },
    )

    return {
        "document_plan": plan,
        "phase": "outliner",
    }
