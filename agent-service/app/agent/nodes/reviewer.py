"""Reviewer node: run a quality gate over the generated content."""
import json
import re
from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.document_strategy import format_document_strategy
from app.agent.events import emit
from app.agent.llm import get_chat_model
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
    draft = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', draft)
    draft = re.sub(r'!\[([^\]]*)\](?!\()', r'> *\1*', draft)
    draft = re.sub(r'[ \t]+$', '', draft, flags=re.MULTILINE)
    return draft


def _detect_artifacts(content: str) -> list[str]:
    artifacts = []
    if "```mermaid" in content:
        artifacts.append("mermaid")
    if re.search(r"^\|.+\|$", content, flags=re.MULTILINE):
        artifacts.append("table")
    if re.search(r"```[a-zA-Z0-9_-]+\n", content):
        artifacts.append("code_block")
    if any(token in content for token in (":::warning", ":::info", ":::danger", ":::success")):
        artifacts.append("callout")
    if ":::details" in content:
        artifacts.append("details")
    if re.search(r"!\[[^\]]*\]\((https?://|/api/)", content):
        artifacts.append("image")
    return artifacts


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
    document_plan = state.get("document_plan") or {}
    used_artifacts = _detect_artifacts(draft)

    messages = [
        SystemMessage(content=REVIEWER_SYSTEM_PROMPT),
        HumanMessage(
            content="\n\n".join(
                [
                    f"Document strategy:\n{format_document_strategy(strategy)}",
                    f"Document plan:\n{json.dumps(document_plan, ensure_ascii=False, indent=2)}",
                    f"Detected artifacts: {', '.join(used_artifacts) if used_artifacts else 'none'}",
                    f"Draft:\n{draft}",
                ]
            )
        ),
    ]
    response = await llm.ainvoke(messages)
    result = parse_review_result(response.content, draft)

    final_content = _auto_fix(
        result["revised_content"] if result["needs_rewrite"] else draft
    )
    summary = result["summary"]
    if result["issues"]:
        summary += f"; issues={len(result['issues'])}"

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
        "needs_revision": False,
    }
