"""Writer node: generate document content based on confirmed outline and document plan."""
import json
import re
from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.cancellation import raise_if_cancelled
from app.agent.document_strategy import (
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.events import emit
from app.agent.llm import get_chat_model
from app.agent.state import AgentState


WRITER_SYSTEM_PROMPT = """你是专业文档作者。基于文档策略、document plan、确认后的大纲和证据材料，生成完整 Markdown 文档。

硬性规则：
1. 严格按确认后的大纲和 document plan 组织内容。
2. 不要堆砌空泛文字；每节都必须服务于该节 goal。
3. 当 document plan 指定 artifact 时，必须显式使用对应结构：
   - mermaid: ```mermaid
   - table: Markdown 表格
   - code_block: 带语言标记的 fenced code block
   - callout: :::info / :::warning / :::danger / :::success
   - details: :::details
   - image: ![alt](url)
4. 如果证据不足，不要编造细节；应使用更保守的表述并明确缺口。
5. 如果用户要求修改选中文本，只输出修改后的片段，不要重写全文。

图片插入规则：
{image_instructions}
"""


def _build_image_instructions(images: list[dict]) -> str:
    if not images:
        return "当前没有可用图片。只有在确有必要且提供了有效 URL 时才插入图片。"

    lines = ["以下图片已可在文档中使用，请在最相关的位置插入："]
    for i, img in enumerate(images, start=1):
        lines.append(f"{i}. ![{img.get('desc', f'图片{i}')}]({img['url']})")
        if img.get("context"):
            lines.append(f"   - 建议位置: {img['context']}")
        if img.get("page_ref"):
            lines.append(f"   - 来源: {img['page_ref']}")
        if img.get("origin"):
            lines.append(f"   - 类型: {img['origin']}")

    lines.append("图片前后必须有解释文字，不能只堆图片。")
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

    image_instructions = _build_image_instructions(state.get("generated_images", []))
    strategy = state.get("document_strategy") or {}
    intent_route = state.get("intent_route") or "document_create"
    scope = state.get("scope") or "blank_page"
    source_policy = state.get("source_policy") or "create_new"
    length_policy = state.get("length_policy") or "preserve"
    prioritize_user_instructions = bool(
        state.get("prioritize_user_instructions", True)
    )
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
    system_prompt = WRITER_SYSTEM_PROMPT.format(image_instructions=image_instructions)

    user_parts = [
        f"文档策略:\n{format_document_strategy(strategy)}",
        f"Document plan:\n{json.dumps(document_plan, ensure_ascii=False, indent=2)}",
    ]

    user_parts.append(
        "Execution intent:\n"
        f"- intent_route: {intent_route}\n"
        f"- scope: {scope}\n"
        f"- source_policy: {source_policy}\n"
        f"- length_policy: {length_policy}\n"
        f"- prioritize_user_instructions: {prioritize_user_instructions}"
    )
    if prioritize_user_instructions:
        user_parts.append(
            "User instructions have the highest priority. Apply default preservation or compression behavior only when the user has not clearly requested otherwise."
        )
    if intent_route == "selection_edit":
        user_parts.append(
            "This is a local selection edit. Output only the replacement for the selected content. Do not expand into a full-document rewrite."
        )
    elif intent_route == "document_transform":
        user_parts.append(
            "This is a source-first document transform. Treat the uploaded files or current page content as the primary source material."
        )
        if length_policy != "compress":
            user_parts.append(
                "Preserve important structure, detail, and reference information unless the user explicitly asked for a shorter output."
            )

    if state.get("system_prompt"):
        user_parts.append(f"Workspace system prompt:\n{state['system_prompt']}")
    if state.get("template_prompt"):
        user_parts.append(f"Resolved template prompt:\n{state['template_prompt']}")

    confirmed_outline = state.get("confirmed_outline", "")
    if confirmed_outline:
        user_parts.append(f"请严格按以下大纲写作：\n\n{confirmed_outline}")
    else:
        user_parts.append(f"用户请求: {state['user_message']}")

    if state.get("page_content"):
        user_parts.append(f"当前页面内容:\n{state['page_content'][:6000]}")
    if state.get("selected_text"):
        user_parts.append(f"用户选中文本（仅修改此部分）:\n{state['selected_text']}")

    research_parts = []
    for item in state.get("parsed_files", []):
        research_parts.append(f"[文件: {item['filename']}]\n{item['content'][:3500]}")
    for item in state.get("research_results", []):
        research_parts.append(f"[来源: {item.get('source', 'unknown')}]\n{item['content'][:2200]}")
    if research_parts:
        user_parts.append(f"证据材料:\n{'---'.join(research_parts)}")

    messages = [SystemMessage(content=system_prompt)]
    for msg in state.get("conversation_history", [])[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
    messages.append(HumanMessage(content="\n\n".join(user_parts)))

    content_chunks = []
    async for chunk in llm.astream(messages):
        await raise_if_cancelled(state)
        text = chunk.content
        if text:
            content_chunks.append(text)
            await emit(tid, {"type": "content", "chunk": text})

    draft_content = "".join(content_chunks)
    draft_content = _strip_empty_images(draft_content)

    await emit(
        tid,
        {
            "type": "step_done",
            "step": "generate",
            "result_summary": f"生成了 {len(draft_content)} 字符",
        },
    )

    return {"draft_content": draft_content}
