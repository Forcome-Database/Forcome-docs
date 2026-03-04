import json
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit

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
5. 是否严格遵循了大纲结构（如有大纲），包括章节顺序、层级和要点覆盖
6. 图片引用是否正确（![alt](url) 格式完整、URL 非空、无残留占位符）

仅输出 JSON，不要输出其他内容。"""


async def reviewer_node(state: AgentState) -> dict:
    """检查生成内容的质量"""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "review", "description": "正在检查内容质量..."})

    draft = state.get("draft_content", "")

    if state.get("iteration_count", 0) >= state.get("max_iterations", 3):
        await emit(tid, {"type": "step_done", "step": "review", "result_summary": "达到最大迭代次数，直接交付"})
        return {
            "final_content": draft,
            "needs_revision": False,
        }

    confirmed_outline = state.get('confirmed_outline', '(无大纲)')

    user_prompt = f"""用户原始请求: {state['user_message']}

确认的大纲:
{confirmed_outline}

生成的文档:
{draft[:5000]}

请审查此文档，特别注意内容是否严格遵循了上述大纲结构，以及图片引用是否正确。"""

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
        await emit(tid, {"type": "step_done", "step": "review", "result_summary": "质量检查通过"})
        return {
            "final_content": draft,
            "needs_revision": False,
        }
    else:
        await emit(tid, {"type": "step_done", "step": "review", "result_summary": f"需要修订: {review.get('feedback', '')[:100]}"})
        return {
            "needs_revision": True,
            "revision_feedback": review.get("feedback", "请改进内容质量"),
            "iteration_count": state.get("iteration_count", 0) + 1,
        }
