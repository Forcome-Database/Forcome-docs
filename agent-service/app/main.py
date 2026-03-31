import asyncio
import json
import sys
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from app.agent.cancellation import (
    AgentCancelledError,
    cancel_task as cancel_in_memory_task,
    register_task as register_in_memory_task,
    unregister_task as unregister_in_memory_task,
)
from app.config import settings
from app.middleware.auth import verify_internal_secret

# Windows asyncio requires SelectorEventLoop for compatibility with some async libs.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown hooks."""
    yield


app = FastAPI(title="Docmost Agent Service", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "docmost-agent"}


# ── Agent Stop Endpoint ─────────────────────────────────────────────

@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: dict):
    task_id = request.get("task_id", "")
    cancelled = cancel_in_memory_task(task_id)
    if cancelled:
        return {"status": "stopping"}
    return {"status": "not_found"}


# ── Web Search Endpoint ──────────────────────────────────────────────

@app.post("/agent/web-search", dependencies=[Depends(verify_internal_secret)])
async def web_search(request: dict):
    """Controlled web search for Wiki Q&A fallback.
    Not an agent — just direct search + optional scrape.
    Returns structured evidence, not free-form text.
    """
    query = request.get("query", "")
    max_results = min(request.get("max_results", 3), 5)  # Hard cap at 5
    scrape_top = min(request.get("scrape_top", 1), 2)    # Hard cap at 2

    if not query or len(query) > 500:
        return {"status": "error", "error": "Invalid query"}

    from tavily import TavilyClient

    if not settings.tavily_api_key:
        return {"status": "error", "error": "Web search not configured (TAVILY_API_KEY missing)"}

    # Step 1: Search using TavilyClient directly (structured JSON)
    try:
        client = TavilyClient(api_key=settings.tavily_api_key)
        results = await asyncio.wait_for(
            asyncio.to_thread(client.search, query=query, max_results=max_results),
            timeout=15,
        )
    except asyncio.TimeoutError:
        return {"status": "error", "query": query, "error": "Web search timed out"}
    except Exception as e:
        return {"status": "error", "query": query, "error": f"Search failed: {e}"}

    # Step 2: Extract structured evidence from Tavily JSON response
    evidence = []
    for r in results.get("results", [])[:max_results]:
        evidence.append({
            "url": r.get("url", ""),
            "title": r.get("title", ""),
            "snippet": (r.get("content", "") or "")[:500],
        })

    # Step 3: Optionally scrape top results for richer content
    if scrape_top > 0 and evidence:
        from app.agent.tools.scrape_url import scrape_url_impl
        for item in evidence[:scrape_top]:
            try:
                scrape_result = await scrape_url_impl(item["url"])
                if scrape_result.get("status") == "success":
                    item["content"] = scrape_result.get("content", "")[:3000]
                    if scrape_result.get("title"):
                        item["title"] = scrape_result["title"]
            except Exception:
                pass

    return {
        "status": "success" if evidence else "no_results",
        "query": query,
        "evidence": evidence,
    }


# ── Intelligent Agent v2 Endpoint ────────────────────────────────────

from app.agent.runner import run_agent as _run_agent
from app.agent.deps import AgentDeps
from app.agent.conversation_store import ConversationStore

_conv_store: ConversationStore | None = None


def _get_conv_store() -> ConversationStore | None:
    global _conv_store
    if _conv_store is None and settings.redis_url:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
        _conv_store = ConversationStore(redis_client)
    return _conv_store


@app.post("/agent/v2/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent_v2(request: dict):
    """Intelligent agent endpoint — single ReAct agent with tool calling.

    Request body:
    {
        "prompt": str,
        "thread_id": str | null,     # 续接对话时传入，null 时自动生成
        "page_id": str | null,
        "workspace_id": str,
        "user_id": str,
        "files": [{"content_b64": str, "filename": str, "mimetype": str}]
    }

    Response: SSE stream of events (session/tool_call/tool_result/content/done/error)
    """
    import base64
    from pydantic_ai.messages import BinaryContent

    thread_id = request.get("thread_id") or str(uuid4())
    user_message = request.get("prompt") or ""
    page_id = request.get("page_id")
    workspace_id = request.get("workspace_id", "")
    user_id = request.get("user_id", "")
    files_raw = request.get("files") or []
    page_content = request.get("page_content", "")

    # Parse selection context
    from app.agent.deps import SelectionContext
    selection = None
    edit_mode_raw = request.get("edit_mode")
    if edit_mode_raw in ("replace", "insert"):
        selection = SelectionContext(
            edit_mode=edit_mode_raw,
            selected_text=request.get("selected_text", ""),
            context_before=request.get("context_before", ""),
            context_after=request.get("context_after", ""),
            document_outline=request.get("document_outline", ""),
        )

    deps = AgentDeps(
        thread_id=thread_id,
        page_id=page_id,
        workspace_id=workspace_id,
        user_id=user_id,
        docmost_base_url=settings.effective_docmost_url,
        internal_secret=settings.agent_internal_secret,
        files=files_raw,  # 供工具使用
        session_store=_get_conv_store(),
        page_content=page_content,
        selection=selection,
    )

    # 构建多模态输入 — 仅图片直传 LLM（LLM 原生支持视觉理解）
    # 文档文件（PDF/DOCX/PPTX）不作为多模态传递，强制走 extract_document 工具
    _IMAGE_MIMETYPES = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
    multimodal_parts = []
    doc_filenames = []
    for f in files_raw:
        mime = f.get("mimetype", "")
        if mime in _IMAGE_MIMETYPES:
            try:
                data = base64.b64decode(f["content_b64"])
                multimodal_parts.append(BinaryContent(data=data, media_type=mime))
            except Exception:
                pass
        else:
            doc_filenames.append(f.get("filename", "unknown"))

    # 文档文件不作为多模态传递，但必须在文本 prompt 中告知 Agent 有文件上传
    if doc_filenames:
        file_list = ", ".join(doc_filenames)
        user_message = f"{user_message}\n\n[Uploaded files: {file_list}]\nCall extract_document tool to process these files."

    task_id = str(uuid4())

    async def event_generator():
        register_in_memory_task(task_id, thread_id)
        try:
            yield {"data": json.dumps({"type": "session", "thread_id": thread_id, "task_id": task_id}, ensure_ascii=False)}
            async for event in _run_agent(
                user_message, deps, multimodal_parts=multimodal_parts or None
            ):
                yield {"data": json.dumps(event, ensure_ascii=False)}
        finally:
            unregister_in_memory_task(task_id, thread_id)

    return EventSourceResponse(event_generator())
