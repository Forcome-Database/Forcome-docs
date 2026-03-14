"""Outliner node: generate structured outline for user approval."""

import json

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import interrupt

from app.agent.document_strategy import (
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.events import emit
from app.agent.llm import get_chat_model
from app.agent.state import AgentState


OUTLINER_SYSTEM_PROMPT = """You are a document outliner.
Generate a clean Markdown outline grounded in the document strategy, document plan, research, and user context.

Rules:
1. Output only the Markdown outline, not the full draft.
2. Use ## and ### headings.
3. Under each section, add 1-2 short sentences explaining the section goal and key points.
4. Do not include internal planning markers such as [Artifact: table]. Artifact requirements are tracked separately.
5. Keep the outline aligned with the provided document plan. Do not invent unrelated sections.
6. If the user only asked to edit selected text, keep the outline scoped to that selection.
"""


def build_outline_artifact_plan(document_plan: dict) -> list[dict]:
    artifact_plan: list[dict] = []

    for section in document_plan.get("sections", []):
        artifacts = list(section.get("artifacts") or [])
        if not artifacts:
            continue
        artifact_plan.append(
            {
                "section_id": section.get("id") or section.get("title") or "section",
                "section_title": section.get("title") or "Section",
                "artifacts": artifacts,
            }
        )

    return artifact_plan


async def outliner_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    llm = get_chat_model()

    await emit(
        tid,
        {
            "type": "step_start",
            "step": "outline",
            "description": "Generating the document outline...",
        },
    )

    strategy = state.get("document_strategy") or {}
    document_plan = normalize_document_plan(
        state.get("document_plan") or {},
        strategy,
    )

    context_parts = [
        f"User request: {state['user_message']}",
        f"Document strategy:\n{format_document_strategy(strategy)}",
        f"Document plan:\n{json.dumps(document_plan, ensure_ascii=False, indent=2)}",
    ]

    if state.get("user_answers"):
        context_parts.append(f"User clarification:\n{state['user_answers']}")
    if state.get("selected_proposal"):
        context_parts.append(
            "Selected proposal:\n"
            + json.dumps(state["selected_proposal"], ensure_ascii=False, indent=2)
        )
    if state.get("selected_text"):
        context_parts.append(f"Selected text:\n{state['selected_text'][:1200]}")
    if state.get("parsed_files"):
        for file_info in state["parsed_files"]:
            context_parts.append(
                f"Parsed file [{file_info['filename']}]:\n{file_info['content'][:400]}"
            )
    if state.get("research_results"):
        for result in state["research_results"][:4]:
            context_parts.append(
                f"Research [{result.get('source', '')}]:\n{result.get('content', '')[:300]}"
            )
    if state.get("revision_feedback"):
        context_parts.append(f"Revision feedback:\n{state['revision_feedback']}")

    messages = [
        SystemMessage(content=OUTLINER_SYSTEM_PROMPT),
        HumanMessage(content="\n\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)
    outline = response.content

    await emit(
        tid,
        {
            "type": "step_done",
            "step": "outline",
            "result_summary": "Outline generated and waiting for approval",
        },
    )

    artifact_plan = build_outline_artifact_plan(document_plan)

    user_decision = interrupt(
        {
            "type": "outline",
            "outline": outline,
            "artifact_plan": artifact_plan,
        }
    )

    action = (
        user_decision.get("action", "confirm")
        if isinstance(user_decision, dict)
        else "confirm"
    )

    if action == "regenerate":
        feedback = user_decision.get("feedback", "")
        return {
            "outline": outline,
            "confirmed_outline": "",
            "revision_feedback": feedback,
            "phase": "outliner",
        }

    confirmed = (
        user_decision.get("confirmed_outline", outline)
        if isinstance(user_decision, dict)
        else outline
    )

    return {
        "outline": outline,
        "confirmed_outline": confirmed,
        "phase": "writer",
    }
