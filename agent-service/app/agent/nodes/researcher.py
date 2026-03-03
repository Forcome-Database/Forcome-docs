import json
import httpx
import base64
from app.agent.state import AgentState
from app.agent.events import emit
from app.config import settings
from app.tools.registry import get_tool

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


async def researcher_node(state: AgentState) -> dict:
    """执行计划中的调研步骤：文件解析、网络搜索、网页爬取、图片上传"""
    tid = state.get("_task_id", "")
    plan = state.get("plan", [])
    research_results = list(state.get("research_results", []))
    parsed_files = list(state.get("parsed_files", []))
    generated_images = list(state.get("generated_images", []))
    page_id = state.get("page_id", "")

    for step in plan:
        if step["action"] not in RESEARCH_ACTIONS:
            continue
        if step["status"] == "done":
            continue

        step["status"] = "running"
        await emit(tid, {"type": "step_start", "step": step["action"], "description": step["description"]})

        tool_name = step.get("tool")
        tool_fn = get_tool(tool_name) if tool_name else None
        result_summary = "跳过（无匹配工具）"

        try:
            if step["action"] == "parse" and tool_fn:
                for f in state.get("uploaded_files", []):
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
                            img_filename = f"doc-img-{img['index']}.png"
                            url = await _upload_image_to_docmost(img["b64"], img_filename, page_id)
                            if url:
                                image_urls.append({"index": img["index"], "url": url, "desc": img.get("desc", "")})
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
                if url:
                    result = await tool_fn.ainvoke({"url": url})
                    research_results.append({"source": "crawl", "url": url, "content": result})
                    result_summary = f"爬取了 {url}"

            step["status"] = "done"
        except Exception as e:
            step["status"] = "skipped"
            result_summary = f"失败: {str(e)[:100]}"
            await emit(tid, {"type": "error", "message": f"工具 {tool_name} 调用失败: {str(e)[:200]}"})

        await emit(tid, {"type": "step_done", "step": step["action"], "result_summary": result_summary})

    return {
        "plan": plan,
        "research_results": research_results,
        "parsed_files": parsed_files,
        "generated_images": generated_images,
    }
