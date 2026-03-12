"""Proposer node: suggest 2-3 writing approaches for user to choose.

Uses interrupt() to pause and wait for user's choice.
Can be skipped for simple/template-driven requests.
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


PROPOSER_SYSTEM_PROMPT = """你是一个写作方案规划师。基于用户需求和调研结果，提出 2-3 个写作方向/结构方案。

如果请求很简单或已选模板，不需要提方案，返回:
{{"needs_proposal": false}}

如果需要提方案，返回:
{{"needs_proposal": true, "proposals": [
  {{"title": "方案名称", "description": "简要描述该方案的侧重点和结构特色，50字以内"}},
  ...
]}}

规则:
- 每个方案的侧重点要有明显差异
- 描述要简洁有对比性
- 最多 3 个方案
"""


async def proposer_node(state: AgentState) -> dict:
    """Propose writing approaches; interrupt for user choice."""
    tid = state.get("_thread_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "propose", "description": "正在构思写作方案..."})

    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("user_answers"):
        context_parts.append(f"用户补充说明: {state['user_answers']}")
    if state.get("template_id"):
        context_parts.append(f"选择的模板: {state['template_id']}")
    if state.get("research_results"):
        for r in state["research_results"][:3]:
            context_parts.append(f"调研[{r.get('source', '')}]: {r.get('content', '')[:300]}")

    messages = [
        SystemMessage(content=PROPOSER_SYSTEM_PROMPT),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {"needs_proposal": False}

    if not result.get("needs_proposal", False):
        await emit(tid, {"type": "step_done", "step": "propose", "result_summary": "请求明确，跳过方案提议"})
        return {"phase": "outliner"}

    proposals = result.get("proposals", [])

    await emit(tid, {"type": "step_done", "step": "propose", "result_summary": f"提出了 {len(proposals)} 个方案"})

    # await_input emitted from main.py's GraphInterrupt handler
    user_choice = interrupt({
        "type": "propose",
        "proposals": proposals,
    })

    selected_idx = user_choice.get("selected_proposal", 0) if isinstance(user_choice, dict) else 0
    selected = proposals[selected_idx] if selected_idx < len(proposals) else proposals[0] if proposals else {}
    feedback = user_choice.get("feedback", "") if isinstance(user_choice, dict) else ""

    return {
        "proposals": proposals,
        "selected_proposal": {**selected, "user_feedback": feedback},
        "phase": "outliner",
    }
