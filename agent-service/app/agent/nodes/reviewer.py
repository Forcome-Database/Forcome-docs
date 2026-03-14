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


REVIEWER_SYSTEM_PROMPT = """你是严格的文档质量审核员。
检查草稿是否满足用户意图、文档策略和文档计划。

只返回 JSON：
{
  "summary": "一句话总结审核结果",
  "issues": ["问题1", "问题2"],
  "artifacts_used": ["table", "mermaid"],
  "needs_rewrite": true,
  "revised_content": "修改后的内容（仅小修时提供）或空字符串",
  "length_assessment": "篇幅是否达标的评估"
}

审核维度：
1. 准确性：内容是否基于提供的素材，有无编造
2. 完整性：是否覆盖了文档计划中所有章节和要点
3. 篇幅合规：输出篇幅是否与 length_policy 要求一致（preserve=保持原文篇幅，expand=扩展，compress=精简）
4. 风格一致：是否匹配目标受众和文档类型
5. 结构清晰：是否有清晰的层次、标题和过渡
6. 素材引用：是否合理使用了提供的图片、表格、代码等素材

规则：
1. 如果草稿基本正确，仅需小修（修正错别字、调整措辞），提供 revised_content
2. 如果草稿严重偏离计划、篇幅严重不足、或缺少关键内容，设 needs_rewrite=true
3. 如果草稿可以接受，设 needs_rewrite=false
4. 不要编造不存在的来源、截图或图片
5. 审核时不要大幅改写内容，只做必要的局部修正
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
        if len(source_text) > 1200 and len(draft) < max(400, int(len(source_text) * 0.7)):
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
