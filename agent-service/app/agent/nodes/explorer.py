import json
import httpx
from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.cancellation import raise_if_cancelled
from app.agent.document_strategy import derive_visual_requirements, format_document_strategy
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit
from app.config import settings
from app.tools.registry import get_tool_names, get_tool

EXPLORER_SYSTEM_PROMPT = """你是智能文档助手的研究规划器。你的任务是分析用户请求，并制定调研计划。
可用工具: {tools}

输出 JSON 数组。每个元素格式：
{{
  "step_id": 1,
  "action": "page_read|knowledge_search|search|parse|crawl|vision|image",
  "description": "中文描述",
  "tool": "工具名或 null",
  "args": {{}}
}}

规则：
1. 用户上传文件时，必须包含 parse。
2. 如果当前页内容或选区对任务很重要，应包含 page_read。
3. 如果需要站内知识，应包含 knowledge_search。
4. 如果需要外部事实，应包含 search；提供 URL 时可包含 crawl。
5. 如果资料包含图片、截图或界面，需要 vision。
6. 只有当图片对完成高质量文档是必要且现有资料不足时，才规划 image。
7. 如果文档策略要求特定 artifact，而现有资料不足以支撑，应优先补调研，不要直接写作。
8. 计划应精简，不超过 10 步；如无需调研，返回 []。
9. 只输出 JSON，不输出其他内容。
10. 当用户提供了 URL 时，如果抓取该 URL 的结果信息量不足以支撑文档写作，应额外规划 crawl 步骤抓取该 URL 下的子链接或相关页面（最多额外 3 个 URL）。
11. 如果现有素材明显不足以支撑一篇完整文档，在 description 中标注"素材可能不足，建议补充"。
12. 对于仿写/改写任务，必须规划 parse 或 crawl 步骤来提取原文的完整内容和结构特征，不能只看摘要。
"""

RESEARCH_ACTIONS = {
    "page_read",
    "knowledge_search",
    "search",
    "parse",
    "crawl",
    "vision",
    "image",
}

RESEARCH_SKIP_PHRASES = (
    "no external research",
    "no research needed",
    "do not browse",
    "do not search",
    "do not call external tools",
    "无需外部调研",
    "不需要外部调研",
    "不要检索",
    "不要搜索",
    "不要调用外部工具",
)


def should_skip_research_planning(state: AgentState) -> bool:
    intent_route = state.get("intent_route") or "document_create"

    if intent_route == "selection_edit":
        return True

    if intent_route == "document_transform":
        return True

    if state.get("uploaded_files"):
        return False

    message = str(state.get("user_message", "") or "").lower()
    return any(phrase in message for phrase in RESEARCH_SKIP_PHRASES)


def build_source_first_plan(state: AgentState) -> list[dict]:
    plan: list[dict] = []

    if state.get("uploaded_files"):
        plan.append(
            {
                "step_id": 1,
                "action": "parse",
                "description": "解析用户上传的源文档并提取关键信息",
                "tool": "docling_parser",
                "args": {},
                "status": "pending",
            }
        )

    if (
        state.get("page_id")
        and not state.get("page_content")
        and not state.get("selected_text")
    ):
        plan.append(
            {
                "step_id": len(plan) + 1,
                "action": "page_read",
                "description": "读取当前页面内容作为改写依据",
                "tool": "docmost_page_read",
                "args": {},
                "status": "pending",
            }
        )

    return plan


async def _upload_image_to_docmost(b64_data: str, filename: str, page_id: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.docmost_internal_url}/api/ai/internal/upload-page-image",
                json={
                    "pageId": page_id,
                    "filename": filename,
                    "fileContentB64": b64_data,
                    "mimeType": "image/png",
                },
                headers={"X-Internal-Secret": settings.agent_internal_secret},
            )

        if 200 <= resp.status_code < 300:
            result = resp.json()
            file_data = result.get("data", result)
            file_url = file_data.get("url", "")
            if file_url:
                return file_url
        return ""
    except Exception:
        return ""


async def explorer_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    await raise_if_cancelled(state)

    llm = get_chat_model()
    tools = get_tool_names()

    await emit(tid, {"type": "step_start", "step": "plan", "description": "正在分析需求并制定调研计划..."})

    strategy = state.get("document_strategy") or {}
    context_parts = [
        f"用户请求: {state['user_message']}",
        f"文档策略:\n{format_document_strategy(strategy)}",
    ]

    if state.get("page_title"):
        context_parts.append(f"当前页面标题: {state['page_title']}")
    if state.get("selected_text"):
        context_parts.append(f"用户选中文本: {state['selected_text'][:500]}")
    if state.get("page_content"):
        context_parts.append(f"当前页面已有内容摘要: {state['page_content'][:800]}")
    if state.get("uploaded_files"):
        file_names = [f["filename"] for f in state["uploaded_files"]]
        context_parts.append(f"上传的文件: {', '.join(file_names)}")
    if state.get("revision_feedback"):
        context_parts.append(f"上次修订反馈: {state['revision_feedback']}")

    visual_requirements = derive_visual_requirements(state)
    if visual_requirements:
        context_parts.append(f"从任务中推断的优先 artifact: {', '.join(visual_requirements)}")

    intent_route = state.get("intent_route") or "document_create"
    if intent_route == "document_transform":
        plan = build_source_first_plan(state)
    elif should_skip_research_planning(state):
        plan = []
    else:
        messages = [
            SystemMessage(content=EXPLORER_SYSTEM_PROMPT.format(tools=", ".join(tools))),
            HumanMessage(content="\n\n".join(context_parts)),
        ]

        response = await llm.ainvoke(messages)
        try:
            plan = json.loads(response.content)
        except json.JSONDecodeError:
            plan = []

    if not isinstance(plan, list):
        plan = []

    for step in plan:
        if isinstance(step, dict):
            step["status"] = "pending"

    await emit(tid, {"type": "step_done", "step": "plan", "result_summary": f"制定了 {len(plan)} 步调研计划"})

    research_results = list(state.get("research_results", []))
    parsed_files = list(state.get("parsed_files", []))
    generated_images = list(state.get("generated_images", []))
    page_id = state.get("page_id", "")

    for step in plan:
        await raise_if_cancelled(state)
        if not isinstance(step, dict):
            continue
        if step.get("action") not in RESEARCH_ACTIONS:
            continue
        if step.get("status") == "done":
            continue

        step["status"] = "running"
        action = step["action"]
        await emit(tid, {"type": "step_start", "step": action, "description": step.get("description", action)})

        if action == "parse":
            tool_name = "docling_parser"
        elif action == "crawl":
            tool_name = "firecrawl_scrape"
        elif action == "search":
            tool_name = "tavily_search"
        elif action == "page_read":
            tool_name = "docmost_page_read"
        elif action == "knowledge_search":
            tool_name = "docmost_rag"
        elif action == "vision":
            tool_name = "vlm_understand"
        elif action == "image":
            tool_name = "nanobana_imggen"
        else:
            tool_name = step.get("tool")

        tool_fn = get_tool(tool_name) if tool_name else None
        result_summary = "跳过（无匹配工具）"

        try:
            if action == "parse" and tool_fn:
                for file_info in state.get("uploaded_files", []):
                    await raise_if_cancelled(state)
                    raw_result = await tool_fn.ainvoke(
                        {
                            "file_content_b64": file_info["content_b64"],
                            "filename": file_info["filename"],
                            "mimetype": file_info["mimetype"],
                        }
                    )

                    try:
                        parsed = json.loads(raw_result)
                        text_content = parsed.get("text", raw_result)
                        images = parsed.get("images", [])
                    except (json.JSONDecodeError, TypeError):
                        text_content = raw_result
                        images = []

                    image_urls = []
                    if images and page_id:
                        await emit(
                            tid,
                            {
                                "type": "step_start",
                                "step": "upload_images",
                                "description": f"正在上传 {len(images)} 张提取的图片...",
                            },
                        )
                        for img in images:
                            await raise_if_cancelled(state)
                            img_filename = f"doc-img-{img['index']}.png"
                            url = await _upload_image_to_docmost(img["b64"], img_filename, page_id)
                            if url:
                                image_urls.append(
                                    {
                                        "index": img["index"],
                                        "url": url,
                                        "desc": img.get("desc", ""),
                                        "context": img.get("context", ""),
                                        "page_ref": img.get("page_ref", ""),
                                        "surrounding_text": img.get("surrounding_text", ""),
                                        "origin": "uploaded_document",
                                    }
                                )
                                await emit(tid, {"type": "image", "url": url, "alt": img.get("desc", "")})

                        await emit(
                            tid,
                            {
                                "type": "step_done",
                                "step": "upload_images",
                                "result_summary": f"上传了 {len(image_urls)} 张图片",
                            },
                        )

                    parsed_files.append(
                        {
                            "filename": file_info["filename"],
                            "content": text_content,
                            "image_urls": image_urls,
                        }
                    )
                    generated_images.extend(image_urls)

                result_summary = f"解析了 {len(state.get('uploaded_files', []))} 个文件"

            elif action == "page_read" and tool_fn and state.get("page_id"):
                content = await tool_fn.ainvoke({"page_id": state["page_id"]})
                research_results.append({"source": "page_read", "content": content})
                result_summary = "读取了当前页面内容"

            elif action == "knowledge_search" and tool_fn:
                args = step.get("args", {}) or {}
                query = args.get("query", state["user_message"])
                result = await tool_fn.ainvoke(
                    {
                        "query": query,
                        "workspace_id": state.get("workspace_id", ""),
                    }
                )
                research_results.append({"source": "knowledge_search", "query": query, "content": result})
                result_summary = "站内知识检索完成"

            elif action == "search" and tool_fn:
                args = step.get("args", {}) or {}
                query = args.get("query", state["user_message"])
                result = await tool_fn.ainvoke({"query": query, "max_results": 5})
                research_results.append({"source": "search", "query": query, "content": result})
                result_summary = "外部搜索完成"

            elif action == "crawl" and tool_fn:
                args = step.get("args", {}) or {}
                url = args.get("url", "")
                if url and url.startswith(("http://", "https://")) and "." in url.split("/")[2]:
                    result = await tool_fn.ainvoke({"url": url})
                    research_results.append({"source": "crawl", "url": url, "content": result})
                    result_summary = f"抓取了 {url}"
                else:
                    result_summary = f"跳过无效 URL: {url[:80]}"

            elif action == "vision" and tool_fn:
                analyzed = 0
                question = (step.get("args", {}) or {}).get(
                    "question",
                    "请描述这张图片与文档写作最相关的信息，包括界面元素、文字、流程、风险点。",
                )
                for file_info in state.get("uploaded_files", []):
                    await raise_if_cancelled(state)
                    if not str(file_info.get("mimetype", "")).startswith("image/"):
                        continue
                    result = await tool_fn.ainvoke(
                        {
                            "image_b64": file_info["content_b64"],
                            "question": question,
                        }
                    )
                    research_results.append(
                        {
                            "source": "vision",
                            "filename": file_info["filename"],
                            "content": result,
                        }
                    )
                    analyzed += 1
                result_summary = f"分析了 {analyzed} 张图片"

            elif action == "image" and tool_fn and page_id:
                args = step.get("args", {}) or {}
                prompt = args.get("prompt") or state["user_message"]
                generated = await tool_fn.ainvoke({"prompt": prompt})
                image_b64 = generated.split(",", 1)[-1] if isinstance(generated, str) else ""
                if image_b64:
                    filename = f"generated-{len(generated_images) + 1}.png"
                    url = await _upload_image_to_docmost(image_b64, filename, page_id)
                    if url:
                        image_info = {
                            "index": len(generated_images),
                            "url": url,
                            "desc": args.get("alt") or prompt[:80],
                            "context": args.get("context", ""),
                            "page_ref": "generated",
                            "surrounding_text": "",
                            "origin": "generated",
                        }
                        generated_images.append(image_info)
                        research_results.append(
                            {
                                "source": "image_generation",
                                "prompt": prompt,
                                "content": f"Generated image available at {url}",
                            }
                        )
                        await emit(tid, {"type": "image", "url": url, "alt": image_info["desc"]})
                        result_summary = "生成并上传了辅助图片"
                    else:
                        result_summary = "生图完成但上传失败"
                else:
                    result_summary = "未生成可用图片"

            step["status"] = "done"
        except Exception as exc:
            step["status"] = "skipped"
            result_summary = f"失败: {str(exc)[:100]}"
            await emit(tid, {"type": "error", "message": f"工具 {tool_name} 调用失败: {str(exc)[:200]}"})

        await emit(tid, {"type": "step_done", "step": action, "result_summary": result_summary})

    return {
        "plan": plan,
        "current_step": 0,
        "iteration_count": state.get("iteration_count", 0) + 1,
        "research_results": research_results,
        "parsed_files": parsed_files,
        "generated_images": generated_images,
        "phase": "clarifier",
    }
