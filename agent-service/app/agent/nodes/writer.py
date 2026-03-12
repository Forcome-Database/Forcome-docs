"""Writer node: generate document content based on confirmed outline.

Streams content via SSE. Uses image context mapping for accurate placement.
"""
import re
from langchain_core.messages import SystemMessage, HumanMessage

from app.agent.cancellation import raise_if_cancelled
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


WRITER_SYSTEM_PROMPT = """你是一个专业的文档撰写者。基于确认的大纲和调研素材，生成完整的 Markdown 文档。

输出规则:
1. 严格按照大纲结构组织内容
2. 使用 ## 和 ### 标题层级
3. 内容详实、有条理、专业
4. 如果有来源，在文末标注参考链接
5. 如果用户要求修改选中文本，只输出修改后的文本片段

图片插入规则:
{image_instructions}
"""


def _build_image_instructions(images: list[dict]) -> str:
    if not images:
        return "无可用图片。"

    lines = ["以下图片已上传，请在对应位置插入 ![描述](URL)：\n"]
    for i, img in enumerate(images):
        lines.append(f"图 {i+1}: ![{img.get('desc', f'图片{i+1}')}]({img['url']})")
        if img.get("context"):
            lines.append(f"  原始位置: {img['context']}")
        if img.get("page_ref"):
            lines.append(f"  来源: {img['page_ref']}")
        if img.get("surrounding_text"):
            lines.append(f"  上下文: \"{img['surrounding_text'][:100]}\"")
        lines.append("")

    lines.append("插入规则:")
    lines.append("1. 必须在对应章节位置插入图片引用")
    lines.append("2. 每张图片引用恰好使用一次")
    lines.append("3. 图片前后应有解释性文字")
    lines.append("4. 无对应位置的图片放在最相关段落之后")
    return "\n".join(lines)


def _strip_empty_images(md: str) -> str:
    md = re.sub(r'!\[([^\]]*)\]\(\s*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\](?!\()', r'> *\1*', md)
    return md


async def writer_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    llm = get_chat_model()
    await raise_if_cancelled(state)

    await emit(tid, {"type": "step_start", "step": "generate", "description": "正在生成文档内容..."})

    image_urls = state.get("generated_images", [])
    image_instructions = _build_image_instructions(image_urls)
    system_prompt = WRITER_SYSTEM_PROMPT.format(image_instructions=image_instructions)

    user_parts = []

    confirmed_outline = state.get("confirmed_outline", "")
    if confirmed_outline:
        user_parts.append(f"请严格按照以下大纲生成完整正文:\n\n{confirmed_outline}")
    else:
        user_parts.append(f"用户请求: {state['user_message']}")

    if state.get("page_content"):
        user_parts.append(f"\n当前页面内容:\n{state['page_content'][:5000]}")
    if state.get("selected_text"):
        user_parts.append(f"\n用户选中的文本（仅修改此部分）:\n{state['selected_text']}")

    research_parts = []
    for item in state.get("parsed_files", []):
        research_parts.append(f"[文件: {item['filename']}]\n{item['content'][:3000]}")
    for item in state.get("research_results", []):
        research_parts.append(f"[来源: {item.get('source', 'unknown')}]\n{item['content'][:2000]}")
    if research_parts:
        user_parts.append(f"\n调研资料:\n{'---'.join(research_parts)}")

    messages = [SystemMessage(content=system_prompt)]
    for msg in state.get("conversation_history", [])[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
    messages.append(HumanMessage(content="\n".join(user_parts)))

    content_chunks = []
    async for chunk in llm.astream(messages):
        await raise_if_cancelled(state)
        text = chunk.content
        if text:
            content_chunks.append(text)
            await emit(tid, {"type": "content", "chunk": text})

    draft_content = "".join(content_chunks)
    draft_content = _strip_empty_images(draft_content)

    await emit(tid, {"type": "step_done", "step": "generate", "result_summary": f"生成了 {len(draft_content)} 字符"})

    return {"draft_content": draft_content}
