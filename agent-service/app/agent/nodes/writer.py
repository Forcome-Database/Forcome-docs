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


WRITER_SYSTEM_PROMPT = """You are a professional document writer.
Write a complete Markdown document grounded in the document strategy, the document plan, the confirmed outline, and the gathered evidence.

Hard rules:
1. Follow the confirmed outline and document plan when they are available.
2. Do not pad with generic prose. Every section must serve a concrete goal.
3. When the document plan requires an artifact, render the real structure instead of leaving placeholders:
   - mermaid: ```mermaid
   - table: Markdown table
   - code_block: fenced code block with a language tag
   - callout: :::info / :::warning / :::danger / :::success
   - details: :::details
   - image: ![alt](url)
4. If evidence is incomplete, stay conservative and say what is missing instead of inventing details.
5. For source-grounded rewrites, preserve important commands, links, structure, and platform-specific details unless the user explicitly asks to simplify them.
6. For selection edits, output only the replacement text for the selected content.
7. Never invent image URLs, placeholder-image URLs, or stock-image links. Use only exact image URLs that are explicitly provided in the available evidence or image instructions.

写作风格要求（反AI味，必须遵守）：
- 默认使用中文输出，除非用户明确要求其他语言
- 严禁使用以下连接词套路："首先/其次/最后"、"综上所述"、"总而言之"、"值得注意的是"、"需要指出的是"
- 段落长度必须有变化：混合使用 1-2 句短段和 4-6 句长段，不要每段都是 3 句
- 句式多样化：交替使用陈述句、反问句、设问句，避免连续 3 个以上的陈述句
- 用具体数据、真实案例和操作细节替代抽象描述，避免"提升效率"、"优化体验"等空话
- 语气要像一个有经验的专业人士在和同行交流，而不是 AI 在罗列要点
- 避免过度使用"赋能"、"抓手"、"落地"、"生态"、"闭环"等流行词
- 标题不要太工整对称，可以用问句、动词短语或具体描述，不要全用"xxx的xxx"格式
- 不要在每个段落开头都用总结性开头语（"在...方面"、"关于..."）

Image usage rules:
{image_instructions}
"""


def _build_image_instructions(images: list[dict]) -> str:
    if not images:
        return (
            "No usable images are currently available. Insert an image only when a valid "
            "URL exists and the image materially helps the reader."
        )

    lines = ["The following images are available for use in the document:"]
    for index, img in enumerate(images, start=1):
        alt = img.get("desc") or f"image-{index}"
        lines.append(f"{index}. ![{alt}]({img['url']})")
        if img.get("context"):
            lines.append(f"   - Suggested placement: {img['context']}")
        if img.get("page_ref"):
            lines.append(f"   - Source reference: {img['page_ref']}")
        if img.get("origin"):
            lines.append(f"   - Origin: {img['origin']}")

    lines.append("Always explain why an image matters in the surrounding text.")
    return "\n".join(lines)


def _strip_empty_images(md: str) -> str:
    md = re.sub(r"!\[([^\]]*)\]\(\s*\)", r"> *\1*", md)
    md = re.sub(r"!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)", r"> *\1*", md)
    md = re.sub(
        r"!\[([^\]]*)\]\(https?://(?:via\.placeholder\.com|placehold\.co|dummyimage\.com|fakeimg\.pl)[^)]*\)",
        r"> *\1*",
        md,
        flags=re.IGNORECASE,
    )
    md = re.sub(r"!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)", r"> *\1*", md)
    md = re.sub(r"!\[([^\]]*)\](?!\()", r"> *\1*", md)
    return md


def _build_length_instruction(length_policy: str, source_word_count: int = 0) -> str:
    """Build explicit word-count instruction for the LLM."""
    if length_policy == "preserve" and source_word_count > 0:
        return (
            f"\n\n篇幅要求：目标约 {source_word_count} 字（允许±10%偏差）。"
            f"原文约 {source_word_count} 字，你的输出必须达到同等篇幅，不得大幅压缩。"
            f"如果内容不足以支撑该篇幅，请增加细节、案例或深入分析，而不是用空洞句子填充。"
        )
    elif length_policy == "expand" and source_word_count > 0:
        target = int(source_word_count * 1.5)
        return f"\n\n篇幅要求：目标不少于 {target} 字，在原文基础上扩展细节和深度。"
    elif length_policy == "compress":
        return ""
    return ""


def format_research_context_item(item: dict) -> str:
    source = str(item.get("source", "unknown"))
    label = str(item.get("url") or item.get("filename") or source)
    content = str(item.get("content", "") or "")
    excerpt = content[:12000]

    headings = list(
        dict.fromkeys(
            match.group(2).strip()
            for match in re.finditer(r"^(#{1,6})\s+(.+?)\s*$", content, flags=re.MULTILINE)
            if match.group(2).strip()
        )
    )[:12]
    urls = list(
        dict.fromkeys(
            match.group(0).rstrip(".,;:!?")
            for match in re.finditer(r"https?://[^\s<>)\]]+", content)
        )
    )[:12]

    parts = [f"[Source: {source} | {label}]\n{excerpt}"]
    if headings:
        parts.append("Source headings:\n- " + "\n- ".join(headings))
    if urls:
        parts.append("Source URLs:\n- " + "\n- ".join(urls))
    return "\n\n".join(parts)


async def writer_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    llm = get_chat_model()
    await raise_if_cancelled(state)

    await emit(
        tid,
        {
            "type": "step_start",
            "step": "generate",
            "description": "Writing the document...",
        },
    )

    image_instructions = _build_image_instructions(state.get("generated_images", []))
    strategy = state.get("document_strategy") or {}
    intent_route = state.get("intent_route") or "document_create"
    scope = state.get("scope") or "blank_page"
    source_policy = state.get("source_policy") or "create_new"
    length_policy = state.get("length_policy") or "preserve"

    # Calculate source word count for length instruction
    source_word_count = 0
    if state.get("page_content"):
        source_word_count += len(state["page_content"].split())
    for item in state.get("parsed_files", []):
        source_word_count += len(str(item.get("content", "")).split())

    length_instruction = _build_length_instruction(length_policy, source_word_count)

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
        f"Document strategy:\n{format_document_strategy(strategy)}",
        f"Document plan:\n{json.dumps(document_plan, ensure_ascii=False, indent=2)}",
        "Execution intent:\n"
        f"- intent_route: {intent_route}\n"
        f"- scope: {scope}\n"
        f"- source_policy: {source_policy}\n"
        f"- length_policy: {length_policy}\n"
        f"- prioritize_user_instructions: {prioritize_user_instructions}",
    ]

    if length_instruction:
        user_parts.append(length_instruction)

    if prioritize_user_instructions:
        user_parts.append(
            "User instructions have the highest priority. Apply default preservation or "
            "compression behavior only when the user has not clearly requested otherwise."
        )
    if intent_route == "selection_edit":
        user_parts.append(
            "This is a local selection edit. Output only the replacement for the selected content. "
            "Do not expand into a full-document rewrite."
        )
    elif intent_route == "document_transform":
        user_parts.append(
            "This is a source-first document transform. Treat every gathered source as primary "
            "material and keep platform-specific details, commands, and links intact unless the "
            "user explicitly requests a rewrite that changes them."
        )
        if length_policy != "compress":
            user_parts.append(
                "Preserve important structure, detail, and reference information unless the user "
                "explicitly asked for a shorter output."
            )

    if state.get("system_prompt"):
        user_parts.append(f"Workspace system prompt:\n{state['system_prompt']}")
    if state.get("template_prompt"):
        user_parts.append(f"Resolved template prompt:\n{state['template_prompt']}")
    if state.get("revision_feedback"):
        user_parts.append(f"Revision feedback from the reviewer:\n{state['revision_feedback']}")

    confirmed_outline = state.get("confirmed_outline", "")
    if confirmed_outline:
        user_parts.append(f"Follow this confirmed outline strictly:\n\n{confirmed_outline}")
    else:
        user_parts.append(f"User request:\n{state['user_message']}")

    if state.get("page_content"):
        user_parts.append(f"Current page content:\n{state['page_content'][:32000]}")
    if state.get("selected_text"):
        user_parts.append(f"Selected text to edit:\n{state['selected_text']}")

    research_parts = []
    for item in state.get("parsed_files", []):
        research_parts.append(f"[File: {item['filename']}]\n{item['content'][:12000]}")
    for item in state.get("research_results", []):
        research_parts.append(format_research_context_item(item))
    if research_parts:
        user_parts.append(f"Evidence material:\n{'---'.join(research_parts)}")

    messages = [SystemMessage(content=system_prompt)]
    for msg in state.get("conversation_history", [])[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
    messages.append(HumanMessage(content="\n\n".join(user_parts)))

    content_chunks: list[str] = []
    async for chunk in llm.astream(messages):
        await raise_if_cancelled(state)
        text = chunk.content
        if text:
            content_chunks.append(text)
            await emit(tid, {"type": "content", "chunk": text})

    draft_content = _strip_empty_images("".join(content_chunks))

    await emit(
        tid,
        {
            "type": "step_done",
            "step": "generate",
            "result_summary": f"Wrote {len(draft_content)} characters",
        },
    )

    return {"draft_content": draft_content}
