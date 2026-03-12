"""Clarifier node: ask user clarifying questions before proceeding.

Uses interrupt() to pause the graph and wait for user input.
Can be skipped if the LLM determines the request is clear enough.
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


CLARIFIER_SYSTEM_PROMPT = """你是一个需求分析助手。基于用户请求和调研结果，判断是否需要向用户提出澄清问题。

如果用户需求已经足够明确（有清晰的主题、范围和目标），返回:
{{"needs_clarify": false}}

如果需要澄清，返回:
{{"needs_clarify": true, "questions": ["问题1", "问题2", ...]}}

规则:
- 最多提 3 个问题
- 问题要具体、有选项感（如"你希望重点分析方案A还是方案B？"）
- 不要问显而易见的问题
- 如果用户提供了模板（如"技术文档"），说明意图已较明确
"""


async def clarifier_node(state: AgentState) -> dict:
    """Analyze if clarification is needed; interrupt if so."""
    tid = state.get("_thread_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "clarify", "description": "正在分析是否需要进一步了解需求..."})

    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("template_id"):
        context_parts.append(f"选择的模板: {state['template_id']}")
    if state.get("research_results"):
        summaries = [r.get("content", "")[:200] for r in state["research_results"][:3]]
        context_parts.append(f"调研结果摘要: {'; '.join(summaries)}")
    if state.get("parsed_files"):
        file_names = [f["filename"] for f in state["parsed_files"]]
        context_parts.append(f"已解析的文件: {', '.join(file_names)}")

    messages = [
        SystemMessage(content=CLARIFIER_SYSTEM_PROMPT),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {"needs_clarify": False}

    if not result.get("needs_clarify", False):
        await emit(tid, {"type": "step_done", "step": "clarify", "result_summary": "需求已明确，跳过澄清"})
        return {"phase": "proposer"}

    questions = result.get("questions", [])

    await emit(tid, {"type": "step_done", "step": "clarify", "result_summary": f"提出了 {len(questions)} 个澄清问题"})

    # interrupt() pauses graph on first call; on resume, the node re-executes
    # from the start and interrupt() returns the resume value immediately.
    # await_input is emitted from main.py's GraphInterrupt handler (not here)
    # to avoid duplicate events on resume.
    user_response = interrupt({
        "type": "clarify",
        "questions": questions,
    })

    return {
        "clarify_questions": questions,
        "user_answers": user_response.get("answers", "") if isinstance(user_response, dict) else str(user_response),
        "phase": "proposer",
    }
