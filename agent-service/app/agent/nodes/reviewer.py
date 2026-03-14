"""Reviewer node: run a quality gate over the generated content."""
import json
import re
from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.document_strategy import (
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.events import emit
from app.agent.llm import get_chat_model
from app.agent.quality_checks import detect_artifacts, evaluate_document_quality
from app.agent.state import AgentState


REVIEWER_SYSTEM_PROMPT = """You are a strict document reviewer.
Check whether the draft satisfies the user intent, document strategy, and document plan.

Return only JSON:
{
  "summary": "string",
  "issues": ["issue1", "issue2"],
  "artifacts_used": ["table", "mermaid"],
  "needs_rewrite": true,
  "revised_content": "string or empty"
}

Rules:
1. If the draft is mostly correct but needs small fixes, provide a revised_content.
2. If the draft is missing required artifacts, is too generic, or diverges from plan, set needs_rewrite=true.
3. If the draft is acceptable, set needs_rewrite=false.
4. Do not invent sources, screenshots, or images that do not exist.
"""


def _auto_fix(draft: str) -> str:
    draft = re.sub(r'!\[([^\]]*)\]\(\s*\)', r'> *\1*', draft)
    draft = re.sub(r'!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)', r'> *\1*', draft)
    draft = re.sub(
        r'!\[([^\]]*)\]\(https?://(?:via\.placeholder\.com|placehold\.co|dummyimage\.com|fakeimg\.pl)[^)]*\)',
        r'> *\1*',
        draft,
        flags=re.IGNORECASE,
    )
    draft = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', draft)
    draft = re.sub(r'!\[([^\]]*)\](?!\()', r'> *\1*', draft)
    draft = re.sub(r'[ \t]+$', '', draft, flags=re.MULTILINE)
    return draft

def parse_review_result(raw: str, fallback_content: str) -> dict:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {}

    return {
        "summary": str(parsed.get("summary") or "Quality review completed"),
        "issues": [str(item) for item in parsed.get("issues", []) if str(item).strip()],
        "artifacts_used": [
            str(item) for item in parsed.get("artifacts_used", []) if str(item).strip()
        ],
        "needs_rewrite": bool(parsed.get("needs_rewrite", False)),
        "revised_content": str(parsed.get("revised_content") or fallback_content),
    }


async def reviewer_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    llm = get_chat_model()

    await emit(
        tid,
        {
            "type": "step_start",
            "step": "review",
            "description": "Reviewing document quality and artifact coverage...",
        },
    )

    draft = _auto_fix(state.get("draft_content", ""))
    strategy = state.get("document_strategy") or {}
    intent_route = state.get("intent_route") or "document_create"
    length_policy = state.get("length_policy") or "preserve"
    document_plan = normalize_document_plan(
        state.get("document_plan") or {},
        strategy,
    )
    if intent_route == "selection_edit":
        document_plan = {
            "doc_type": "selection-edit",
            "audience": "",
            "required_artifacts": [],
            "sections": [],
        }
    if intent_route == "selection_edit":
        deterministic_review = {
            "used_artifacts": detect_artifacts(draft),
            "missing_artifacts": [],
            "missing_sections": [],
            "missing_coverage": [],
            "issues": [],
            "needs_rewrite": False,
        }
    else:
        deterministic_review = evaluate_document_quality(draft, strategy, document_plan)

    if intent_route == "document_transform" and length_policy != "compress":
        source_parts: list[str] = []
        if state.get("page_content"):
            source_parts.append(str(state.get("page_content") or ""))
        for item in state.get("parsed_files", []):
            source_parts.append(str(item.get("content") or ""))
        for item in state.get("research_results", []):
            source_parts.append(str(item.get("content") or ""))

        source_text = "\n".join(part for part in source_parts if part).strip()
        if len(source_text) > 1200 and len(draft) < max(400, int(len(source_text) * 0.2)):
            deterministic_review["issues"].append(
                "Draft appears over-compressed relative to the source material"
            )
            deterministic_review["needs_rewrite"] = True
    used_artifacts = deterministic_review["used_artifacts"]

    messages = [
        SystemMessage(content=REVIEWER_SYSTEM_PROMPT),
        HumanMessage(
            content="\n\n".join(
                [
                    f"Document strategy:\n{format_document_strategy(strategy)}",
                    f"Document plan:\n{json.dumps(document_plan, ensure_ascii=False, indent=2)}",
                    f"Detected artifacts: {', '.join(used_artifacts) if used_artifacts else 'none'}",
                    "Deterministic precheck issues: "
                    + (
                        "; ".join(deterministic_review["issues"])
                        if deterministic_review["issues"]
                        else "none"
                    ),
                    f"Draft:\n{draft}",
                ]
            )
        ),
    ]
    response = await llm.ainvoke(messages)
    result = parse_review_result(response.content, draft)
    merged_issues = list(dict.fromkeys(deterministic_review["issues"] + result["issues"]))
    needs_rewrite = bool(deterministic_review["needs_rewrite"] or result["needs_rewrite"])

    final_content = _auto_fix(
        result["revised_content"] if needs_rewrite else draft
    )
    summary = result["summary"]
    if merged_issues:
        summary += f"; issues={len(merged_issues)}"

    await emit(
        tid,
        {
            "type": "step_done",
            "step": "review",
            "result_summary": summary,
        },
    )

    return {
        "final_content": final_content,
        "needs_revision": needs_rewrite,
        "revision_feedback": "; ".join(merged_issues),
        "iteration_count": state.get("iteration_count", 0) + 1,
    }
