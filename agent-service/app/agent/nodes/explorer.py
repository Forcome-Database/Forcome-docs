import json
import httpx
import base64
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.cancellation import raise_if_cancelled
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit
from app.config import settings
from app.tools.registry import get_tool_names, get_tool

EXPLORER_SYSTEM_PROMPT = """你是一个智能文档助手的调研规划器。你的任务是分析用户的请求，并制定调研步骤计划。

可用工具: {tools}

根据用户的请求和上下文，输出一个 JSON 数组格式的调研计划。每个步骤包含:
- step_id: 步骤编号（从 1 开始）
- action: 动作类型（search/parse/crawl）
- description: 步骤描述（中文）
- tool: 要使用的工具名（从可用工具中选择，或 null）
- args: 工具参数提示（dict 或 null）

规则:
1. 如果用户上传了文件，必须包含 parse 步骤
2. 如果需要外部知识，包含 search 步骤
3. 如果用户提供了 URL，包含 crawl 步骤
4. 只生成调研步骤（search/parse/crawl），不包含 generate 步骤
5. 计划应精简，不超过 6 个步骤
6. 如果不需要任何调研，返回空数组 []

仅输出 JSON 数组，不要输出其他内容。"""

RESEARCH_ACTIONS = {"search", "parse", "crawl"}


async def _upload_image_to_docmost(b64_data: str, filename: str, page_id: str) -> str:
    """Upload a base64 image to Docmost storage, return the file URL."""
    try:
        img_bytes = base64.b64decode(b64_data)
        url = f"{settings.docmost_internal_url}/api/files/upload"
        files = {"file": (filename, img_bytes, "image/png")}
        data = {"pageId": page_id}
        headers = {"X-Internal-Secret": settings.agent_internal_secret}

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, files=files, data=data, headers=headers)

        if resp.status_code == 200:
            result = resp.json()
            # Response may be wrapped: {data: {filePath: "...", fileName: "..."}}
            file_data = result.get("data", result)
            file_path = file_data.get("filePath", "")
            file_name = file_data.get("fileName", filename)
            if file_path:
                return f"/api/files/{file_path}/{file_name}"
        return ""
    except Exception:
        return ""


async def explorer_node(state: AgentState) -> dict:
    """Phase 1: 使用 LLM 制定调研计划；Phase 2: 遍历计划执行 search/parse/crawl 步骤"""
    tid = state.get("_thread_id", "")
    await raise_if_cancelled(state)

    # ── Phase 1: 制定调研计划 ──────────────────────────────────
    llm = get_chat_model()
    tools = get_tool_names()

    await emit(tid, {"type": "step_start", "step": "plan", "description": "正在分析需求并制定调研计划..."})

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

请制定调研计划。"""

    messages = [
        SystemMessage(content=EXPLORER_SYSTEM_PROMPT.format(tools=", ".join(tools))),
        HumanMessage(content=user_prompt),
    ]

    response = await llm.ainvoke(messages)
    try:
        plan = json.loads(response.content)
    except json.JSONDecodeError:
        plan = []

    for step in plan:
        step["status"] = "pending"

    await emit(tid, {"type": "step_done", "step": "plan", "result_summary": f"制定了 {len(plan)} 步调研计划"})

    # ── Phase 2: 遍历计划执行调研步骤 ──────────────────────────
    research_results = list(state.get("research_results", []))
    parsed_files = list(state.get("parsed_files", []))
    generated_images = list(state.get("generated_images", []))
    page_id = state.get("page_id", "")

    for step in plan:
        await raise_if_cancelled(state)
        if step["action"] not in RESEARCH_ACTIONS:
            continue
        if step["status"] == "done":
            continue

        step["status"] = "running"
        await emit(tid, {"type": "step_start", "step": step["action"], "description": step["description"]})

        # Force correct tool per action type (LLM sometimes assigns wrong tool)
        SEARCH_TOOLS = {"tavily_search"}
        action = step["action"]
        if action == "parse":
            tool_name = "docling_parser"
        elif action == "crawl":
            tool_name = "firecrawl_scrape"
        elif action == "search":
            tool_name = step.get("tool")
            if tool_name not in SEARCH_TOOLS:
                tool_name = "tavily_search"  # fallback to web search
        else:
            tool_name = step.get("tool")
        tool_fn = get_tool(tool_name) if tool_name else None
        result_summary = "跳过（无匹配工具）"

        try:
            if step["action"] == "parse" and tool_fn:
                for f in state.get("uploaded_files", []):
                    await raise_if_cancelled(state)
                    raw_result = await tool_fn.ainvoke({
                        "file_content_b64": f["content_b64"],
                        "filename": f["filename"],
                        "mimetype": f["mimetype"],
                    })

                    # docling_parser now returns JSON with text + images
                    try:
                        parsed = json.loads(raw_result)
                        text_content = parsed.get("text", raw_result)
                        images = parsed.get("images", [])
                    except (json.JSONDecodeError, TypeError):
                        text_content = raw_result
                        images = []

                    # Upload extracted images to Docmost
                    image_urls = []
                    if images and page_id:
                        await emit(tid, {"type": "step_start", "step": "upload_images",
                                         "description": f"正在上传 {len(images)} 张提取的图片..."})
                        for img in images:
                            await raise_if_cancelled(state)
                            img_filename = f"doc-img-{img['index']}.png"
                            url = await _upload_image_to_docmost(img["b64"], img_filename, page_id)
                            if url:
                                image_urls.append({
                                    "index": img["index"],
                                    "url": url,
                                    "desc": img.get("desc", ""),
                                    "context": img.get("context", ""),
                                    "page_ref": img.get("page_ref", ""),
                                    "surrounding_text": img.get("surrounding_text", ""),
                                })
                                await emit(tid, {"type": "image", "url": url, "alt": img.get("desc", "")})

                        await emit(tid, {"type": "step_done", "step": "upload_images",
                                         "result_summary": f"上传了 {len(image_urls)} 张图片"})

                    parsed_files.append({
                        "filename": f["filename"],
                        "content": text_content,
                        "image_urls": image_urls,
                    })
                    generated_images.extend(image_urls)

                file_count = len(state.get("uploaded_files", []))
                img_count = len(generated_images)
                result_summary = f"解析了 {file_count} 个文件" + (f"，提取了 {img_count} 张图片" if img_count else "")

            elif step["action"] == "search" and tool_fn:
                args = step.get("args", {}) or {}
                query = args.get("query", state["user_message"])
                result = await tool_fn.ainvoke({"query": query, "max_results": 5})
                research_results.append({"source": "search", "query": query, "content": result})
                result_summary = "搜索完成"

            elif step["action"] == "crawl" and tool_fn:
                args = step.get("args", {}) or {}
                url = args.get("url", "")
                # Validate URL: must start with http(s) and have a dot in domain
                if url and url.startswith(("http://", "https://")) and "." in url.split("/")[2]:
                    result = await tool_fn.ainvoke({"url": url})
                    research_results.append({"source": "crawl", "url": url, "content": result})
                    result_summary = f"爬取了 {url}"
                else:
                    result_summary = f"跳过无效 URL: {url[:80]}"

            step["status"] = "done"
        except Exception as e:
            step["status"] = "skipped"
            result_summary = f"失败: {str(e)[:100]}"
            await emit(tid, {"type": "error", "message": f"工具 {tool_name} 调用失败: {str(e)[:200]}"})

        await emit(tid, {"type": "step_done", "step": step["action"], "result_summary": result_summary})

    return {
        "plan": plan,
        "current_step": 0,
        "iteration_count": state.get("iteration_count", 0) + 1,
        "research_results": research_results,
        "parsed_files": parsed_files,
        "generated_images": generated_images,
        "phase": "clarifier",
    }
