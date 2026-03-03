import json
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.tools.registry import get_tool_names

PLANNER_SYSTEM_PROMPT = """你是一个智能文档助手的规划器。你的任务是分析用户的请求，并制定一个多步骤执行计划。

可用工具: {tools}

根据用户的请求和上下文，输出一个 JSON 数组格式的执行计划。每个步骤包含:
- step_id: 步骤编号（从 1 开始）
- action: 动作类型（search/parse/crawl/generate/image/annotate/review）
- description: 步骤描述（中文）
- tool: 要使用的工具名（从可用工具中选择，或 null）
- args: 工具参数提示（dict 或 null）

规则:
1. 如果用户上传了文件，必须包含 parse 步骤
2. 如果需要外部知识，包含 search 步骤
3. 如果用户提供了 URL，包含 crawl 步骤
4. 最后一步必须是 generate（生成文档内容）
5. 如果需要图片，在 generate 之后加 image 步骤
6. 计划应精简，不超过 8 个步骤

仅输出 JSON 数组，不要输出其他内容。"""

async def planner_node(state: AgentState) -> dict:
    """分析用户意图，制定执行计划"""
    llm = get_chat_model()
    tools = get_tool_names()

    context_parts = []
    if state.get("page_title"):
        context_parts.append(f"当前页面标题: {state['page_title']}")
    if state.get("selected_text"):
        context_parts.append(f"用户选中的文本: {state['selected_text'][:500]}")
    if state.get("uploaded_files"):
        file_names = [f["filename"] for f in state["uploaded_files"]]
        context_parts.append(f"上传的文件: {', '.join(file_names)}")
    if state.get("revision_feedback"):
        context_parts.append(f"上次修订反馈: {state['revision_feedback']}")

    context = "\n".join(context_parts) if context_parts else "无额外上下文"

    user_prompt = f"""用户请求: {state['user_message']}

上下文信息:
{context}

请制定执行计划。"""

    messages = [
        SystemMessage(content=PLANNER_SYSTEM_PROMPT.format(tools=", ".join(tools))),
        HumanMessage(content=user_prompt),
    ]

    response = await llm.ainvoke(messages)
    try:
        plan = json.loads(response.content)
    except json.JSONDecodeError:
        plan = [
            {"step_id": 1, "action": "generate", "description": "生成文档内容", "tool": None, "args": None}
        ]

    for step in plan:
        step["status"] = "pending"

    step_events = list(state.get("step_events", []))
    step_events.append({"type": "step_start", "step": "plan", "description": "正在分析需求并制定计划..."})
    step_events.append({"type": "step_done", "step": "plan", "result_summary": f"制定了 {len(plan)} 步执行计划"})

    return {
        "plan": plan,
        "current_step": 0,
        "step_events": step_events,
        "iteration_count": state.get("iteration_count", 0) + 1,
    }
