import json

from app.agent.cancellation import raise_if_cancelled
from app.agent.events import emit
from app.agent.state import AgentState
from app.tools.registry import get_tool


def _with_status(item: dict, *, status: str, error: str | None = None) -> dict:
    updated = dict(item)
    updated["status"] = status
    updated["error"] = error
    return updated


async def evidence_acquirer_node(state: AgentState) -> dict:
    tid = state.get("_thread_id", "")
    uploaded_files = list(state.get("uploaded_files", []))
    research_results = list(state.get("research_results", []))
    parsed_files = list(state.get("parsed_files", []))
    generated_images = list(state.get("generated_images", []))
    updated_evidence_items: list[dict] = []
    page_content = state.get("page_content")

    for item in state.get("evidence_items", []):
        await raise_if_cancelled(state)

        if item.get("status") != "pending":
            updated_evidence_items.append(item)
            continue

        kind = item.get("kind")
        source = item.get("source", "")
        step = "searching" if kind == "web_search" else "reading_sources"
        description = f"Acquiring required evidence: {kind}"
        await emit(tid, {"type": "step_start", "step": step, "description": description})

        try:
            if kind == "reference_url":
                tool = get_tool("firecrawl_scrape")
                if tool is None:
                    raise RuntimeError("firecrawl_scrape tool is unavailable")
                result = await tool.ainvoke({"url": source})
                research_results.append(
                    {
                        "source": "reference_url",
                        "url": source,
                        "content": result,
                    }
                )
                updated_evidence_items.append(_with_status(item, status="success"))

            elif kind == "uploaded_document":
                tool = get_tool("docling_parser")
                file_info = next((file for file in uploaded_files if file.get("filename") == source), None)
                if tool is None:
                    raise RuntimeError("docling_parser tool is unavailable")
                if file_info is None:
                    raise RuntimeError(f"uploaded document not found: {source}")

                raw_result = await tool.ainvoke(
                    {
                        "file_content_b64": file_info["content_b64"],
                        "filename": file_info["filename"],
                        "mimetype": file_info["mimetype"],
                    }
                )
                try:
                    parsed = json.loads(raw_result)
                except (TypeError, json.JSONDecodeError):
                    parsed = {"text": raw_result, "images": []}

                parsed_files.append(
                    {
                        "filename": file_info["filename"],
                        "content": parsed.get("text", raw_result),
                        "image_urls": [],
                    }
                )
                updated_evidence_items.append(_with_status(item, status="success"))

            elif kind == "uploaded_image":
                tool = get_tool("vlm_understand")
                file_info = next((file for file in uploaded_files if file.get("filename") == source), None)
                if tool is None:
                    raise RuntimeError("vlm_understand tool is unavailable")
                if file_info is None:
                    raise RuntimeError(f"uploaded image not found: {source}")

                result = await tool.ainvoke(
                    {
                        "image_b64": file_info["content_b64"],
                        "question": state.get("user_message", ""),
                    }
                )
                research_results.append(
                    {
                        "source": "uploaded_image",
                        "filename": file_info["filename"],
                        "content": result,
                    }
                )
                updated_evidence_items.append(_with_status(item, status="success"))

            elif kind == "page_context":
                if page_content or state.get("selected_text"):
                    research_results.append(
                        {
                            "source": "page_context",
                            "page_id": state.get("page_id"),
                            "content": state.get("selected_text") or page_content or "",
                        }
                    )
                    updated_evidence_items.append(_with_status(item, status="success"))
                elif state.get("page_id"):
                    tool = get_tool("docmost_page_read")
                    if tool is None:
                        raise RuntimeError("docmost_page_read tool is unavailable")
                    page_content = await tool.ainvoke({"page_id": state["page_id"]})
                    research_results.append(
                        {
                            "source": "page_context",
                            "page_id": state.get("page_id"),
                            "content": page_content,
                        }
                    )
                    updated_evidence_items.append(_with_status(item, status="success"))
                else:
                    raise RuntimeError("page context is unavailable")

            elif kind == "web_search":
                tool = get_tool("tavily_search")
                if tool is None:
                    raise RuntimeError("tavily_search tool is unavailable")
                result = await tool.ainvoke(
                    {
                        "query": state.get("user_message", ""),
                        "max_results": 5,
                    }
                )
                research_results.append(
                    {
                        "source": "web_search",
                        "query": state.get("user_message", ""),
                        "content": result,
                    }
                )
                updated_evidence_items.append(_with_status(item, status="success"))

            else:
                updated_evidence_items.append(
                    _with_status(item, status="failed", error=f"Unsupported evidence kind: {kind}")
                )

            await emit(
                tid,
                {
                    "type": "step_done",
                    "step": step,
                    "result_summary": f"Acquired evidence: {kind}",
                },
            )
        except Exception as exc:
            updated_evidence_items.append(
                _with_status(item, status="failed", error=str(exc)[:200] or "Evidence acquisition failed.")
            )
            await emit(
                tid,
                {
                    "type": "step_done",
                    "step": step,
                    "result_summary": f"Failed to acquire evidence: {kind}",
                },
            )

    return {
        "research_results": research_results,
        "parsed_files": parsed_files,
        "generated_images": generated_images,
        "page_content": page_content,
        "evidence_items": updated_evidence_items,
        "phase": "evidence_acquirer",
    }
