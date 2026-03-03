import json
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState

REVIEWER_SYSTEM_PROMPT = """你是一个文档质量审查专家。审查生成的文档是否满足用户需求。

输出 JSON 格式:
{
  "approved": true/false,
  "feedback": "如果不通过，说明具体问题和改进建议（中文）"
}

评审标准:
1. 是否回答了用户的问题/完成了用户的指令
2. 内容是否完整（不是占位符或空洞内容）
3. Markdown 格式是否正确
4. 如果用户要求修改选中文本，是否只修改了选中部分

仅输出 JSON，不要输出其他内容。"""

async def reviewer_node(state: AgentState) -> dict:
    """检查生成内容的质量"""
    llm = get_chat_model()
    step_events = list(state.get("step_events", []))

    step_events.append({"type": "step_start", "step": "review", "description": "正在检查内容质量..."})

    draft = state.get("draft_content", "")

    if state.get("iteration_count", 0) >= state.get("max_iterations", 3):
        step_events.append({"type": "step_done", "step": "review", "result_summary": "达到最大迭代次数，直接交付"})
        return {
            "final_content": draft,
            "needs_revision": False,
            "step_events": step_events,
        }

    user_prompt = f"""用户原始请求: {state['user_message']}

生成的文档:
{draft[:5000]}

请审查此文档。"""

    messages = [
        SystemMessage(content=REVIEWER_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ]

    response = await llm.ainvoke(messages)
    try:
        review = json.loads(response.content)
    except json.JSONDecodeError:
        review = {"approved": True, "feedback": ""}

    if review.get("approved", True):
        step_events.append({"type": "step_done", "step": "review", "result_summary": "质量检查通过"})
        return {
            "final_content": draft,
            "needs_revision": False,
            "step_events": step_events,
        }
    else:
        step_events.append({
            "type": "step_done",
            "step": "review",
            "result_summary": f"需要修订: {review.get('feedback', '')[:100]}",
        })
        return {
            "needs_revision": True,
            "revision_feedback": review.get("feedback", "请改进内容质量"),
            "step_events": step_events,
        }
