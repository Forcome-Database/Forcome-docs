import re
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


def _strip_empty_images(md: str) -> str:
    """Remove markdown images that have no real URL (empty, placeholder, or missing src)."""
    md = re.sub(r'!\[([^\]]*)\]\(\s*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\](?!\()', r'> *\1*', md)
    return md


EXECUTOR_SYSTEM_PROMPT = """你是一个专业的文档写作智能体。根据用户的指令和提供的调研资料，生成高质量的 Markdown 文档。

规则:
1. 输出纯 Markdown 格式
2. 使用清晰的标题层级（## 二级标题, ### 三级标题）
3. 内容详实、有条理、专业
4. 如果有引用来源，在文末标注
5. 如果用户要求修改选中的文本，只输出修改后的文本
6. **图片插入规则**：
   - 如果「可用图片列表」中提供了图片 URL，必须在文档合适位置用 `![描述](URL)` 格式插入
   - 按照图片描述和文档内容的逻辑关系，将图片放在最相关的段落之后
   - 没有提供 URL 的图片，用 `> *此处为 XXX 的操作截图*` 占位"""


async def executor_node(state: AgentState) -> dict:
    """综合调研结果，生成文档内容"""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "generate", "description": "正在生成文档内容..."})

    # Build research summary
    research_summary_parts = []
    for item in state.get("parsed_files", []):
        research_summary_parts.append(f"[文件: {item['filename']}]\n{item['content'][:3000]}")
    for item in state.get("research_results", []):
        research_summary_parts.append(f"[来源: {item.get('source', 'unknown')}]\n{item['content'][:2000]}")

    research_summary = "\n\n---\n\n".join(research_summary_parts) if research_summary_parts else "无额外调研资料。"

    # Build available images list
    image_urls = state.get("generated_images", [])
    image_section = ""
    if image_urls:
        image_lines = [f"  - 图片 {img['index']+1}: ![{img['desc']}]({img['url']})" for img in image_urls]
        image_section = "\n\n可用图片列表（请在文档合适位置插入这些图片）:\n" + "\n".join(image_lines)

    # Build user message
    user_parts = [f"用户请求: {state['user_message']}"]

    if state.get("page_content"):
        user_parts.append(f"\n当前页面内容:\n{state['page_content'][:5000]}")
    if state.get("selected_text"):
        user_parts.append(f"\n用户选中的文本（仅修改此部分）:\n{state['selected_text']}")
    if research_summary_parts:
        user_parts.append(f"\n调研资料:\n{research_summary}")
    if image_section:
        user_parts.append(image_section)
    if state.get("revision_feedback"):
        user_parts.append(f"\n上次修订反馈:\n{state['revision_feedback']}")
        user_parts.append(f"\n上次草稿:\n{state.get('draft_content', '')[:5000]}")

    messages = [SystemMessage(content=EXECUTOR_SYSTEM_PROMPT)]
    for msg in state.get("conversation_history", [])[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
    messages.append(HumanMessage(content="\n".join(user_parts)))

    content_chunks = []
    async for chunk in llm.astream(messages):
        text = chunk.content
        if text:
            content_chunks.append(text)
            await emit(tid, {"type": "content", "chunk": text})

    draft_content = "".join(content_chunks)

    # Post-process: strip any remaining empty image references
    draft_content = _strip_empty_images(draft_content)

    await emit(tid, {"type": "step_done", "step": "generate", "result_summary": f"生成了 {len(draft_content)} 字符"})

    return {
        "draft_content": draft_content,
    }
