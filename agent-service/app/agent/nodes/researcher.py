from app.agent.state import AgentState
from app.tools.registry import get_tool

RESEARCH_ACTIONS = {"search", "parse", "crawl"}

async def researcher_node(state: AgentState) -> dict:
    """执行计划中的调研步骤：文件解析、网络搜索、网页爬取"""
    plan = state.get("plan", [])
    research_results = list(state.get("research_results", []))
    parsed_files = list(state.get("parsed_files", []))
    step_events = list(state.get("step_events", []))

    for step in plan:
        if step["action"] not in RESEARCH_ACTIONS:
            continue
        if step["status"] == "done":
            continue

        step["status"] = "running"
        step_events.append({
            "type": "step_start",
            "step": step["action"],
            "description": step["description"],
        })

        tool_name = step.get("tool")
        tool_fn = get_tool(tool_name) if tool_name else None
        result_summary = "跳过（无匹配工具）"

        try:
            if step["action"] == "parse" and tool_fn:
                for f in state.get("uploaded_files", []):
                    result = await tool_fn.ainvoke({
                        "file_content_b64": f["content_b64"],
                        "filename": f["filename"],
                        "mimetype": f["mimetype"],
                    })
                    parsed_files.append({"filename": f["filename"], "content": result})
                result_summary = f"解析了 {len(state.get('uploaded_files', []))} 个文件"

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
            step_events.append({"type": "error", "message": f"工具 {tool_name} 调用失败: {str(e)[:200]}"})

        step_events.append({
            "type": "step_done",
            "step": step["action"],
            "result_summary": result_summary,
        })

    return {
        "plan": plan,
        "research_results": research_results,
        "parsed_files": parsed_files,
        "step_events": step_events,
    }
