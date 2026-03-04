"""Outliner node: generate structured outline for user approval.

Always interrupts — outline confirmation is mandatory.
User can: confirm, edit the outline, or request regeneration via chat.
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


OUTLINER_SYSTEM_PROMPT = """你是一个文档大纲设计师。基于用户需求、调研结果和选定的方案，生成结构化的 Markdown 大纲。

输出格式:
## 1. 第一章标题
  要点概述（1-2句）

## 2. 第二章标题
  ### 2.1 子节标题
    要点概述
  ### 2.2 子节标题
    要点概述

## 3. 第三章标题
  要点概述

规则:
- 使用 ## 和 ### 标题层级
- 每个章节下简要说明要点（不要写正文）
- 如果有图片素材，在相关章节标注"（含图片）"
- 大纲 3-8 个主要章节
- 如果用户选中了文本要修改，大纲仅覆盖修改部分
"""


async def outliner_node(state: AgentState) -> dict:
    """Generate outline and always interrupt for user confirmation."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "outline", "description": "正在生成文档大纲..."})

    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("user_answers"):
        context_parts.append(f"用户补充: {state['user_answers']}")
    if state.get("selected_proposal"):
        prop = state["selected_proposal"]
        context_parts.append(f"选定方案: {prop.get('title', '')} — {prop.get('description', '')}")
        if prop.get("user_feedback"):
            context_parts.append(f"用户对方案的补充: {prop['user_feedback']}")
    if state.get("selected_text"):
        context_parts.append(f"用户选中的文本（仅修改此部分）:\n{state['selected_text'][:1000]}")
    if state.get("parsed_files"):
        for f in state["parsed_files"]:
            context_parts.append(f"文件 [{f['filename']}]: {f['content'][:500]}")
            if f.get("image_urls"):
                img_notes = [f"  图片: {img['desc']} (位置: {img.get('context', '未知')})" for img in f["image_urls"]]
                context_parts.append("\n".join(img_notes))
    if state.get("research_results"):
        for r in state["research_results"][:3]:
            context_parts.append(f"调研[{r.get('source', '')}]: {r.get('content', '')[:300]}")
    if state.get("revision_feedback"):
        context_parts.append(f"用户反馈（请据此调整大纲）: {state['revision_feedback']}")

    messages = [
        SystemMessage(content=OUTLINER_SYSTEM_PROMPT),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)
    outline = response.content

    await emit(tid, {
        "type": "await_input",
        "phase": "outline",
        "data": {"outline": outline},
    })
    await emit(tid, {"type": "step_done", "step": "outline", "result_summary": "大纲已生成，等待确认"})

    # Always interrupt: outline confirmation is mandatory
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
