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


OUTLINER_SYSTEM_PROMPT = """你是文档大纲设计师。基于文档策略、document plan、研究结果和用户上下文，生成结构化 Markdown 大纲。

规则：
1. 只输出 Markdown 大纲，不写正文段落。
2. 使用 ## 和 ### 标题层级。
3. 每个章节下用 1-2 句说明该节的目标和要点。
4. 如果某节计划使用 artifact，请显式标注，例如 [Artifact: table]。
5. 大纲应与给定 document plan 一致，不要引入无关章节。
6. 如果用户只要求修改选中文本，大纲只覆盖修改范围。
"""


async def outliner_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "outline", "description": "正在生成文档大纲..."})

    strategy = state.get("document_strategy") or {}
    document_plan = normalize_document_plan(
        state.get("document_plan") or {},
        strategy,
    )

    context_parts = [
        f"用户请求: {state['user_message']}",
        f"文档策略:\n{format_document_strategy(strategy)}",
        f"Document plan:\n{json.dumps(document_plan, ensure_ascii=False, indent=2)}",
    ]

    if state.get("user_answers"):
        context_parts.append(f"用户补充: {state['user_answers']}")
    if state.get("selected_proposal"):
        context_parts.append(
            f"选定方案: {json.dumps(state['selected_proposal'], ensure_ascii=False)}"
        )
    if state.get("selected_text"):
        context_parts.append(f"用户选中文本:\n{state['selected_text'][:1200]}")
    if state.get("parsed_files"):
        for file_info in state["parsed_files"]:
            context_parts.append(f"文件 [{file_info['filename']}]: {file_info['content'][:400]}")
    if state.get("research_results"):
        for result in state["research_results"][:4]:
            context_parts.append(f"调研[{result.get('source', '')}]: {result.get('content', '')[:300]}")
    if state.get("revision_feedback"):
        context_parts.append(f"修订反馈: {state['revision_feedback']}")

    messages = [
        SystemMessage(content=OUTLINER_SYSTEM_PROMPT),
        HumanMessage(content="\n\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)
    outline = response.content

    await emit(tid, {"type": "step_done", "step": "outline", "result_summary": "大纲已生成，等待确认"})

    user_decision = interrupt({
        "type": "outline",
        "outline": outline,
    })

    action = user_decision.get("action", "confirm") if isinstance(user_decision, dict) else "confirm"

    if action == "regenerate":
        feedback = user_decision.get("feedback", "")
        return {
            "outline": outline,
            "confirmed_outline": "",
            "revision_feedback": feedback,
            "phase": "outliner",
        }

    confirmed = user_decision.get("confirmed_outline", outline) if isinstance(user_decision, dict) else outline

    return {
        "outline": outline,
        "confirmed_outline": confirmed,
        "phase": "writer",
    }
