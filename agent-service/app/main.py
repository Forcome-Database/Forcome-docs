import asyncio
import json

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.middleware.auth import verify_internal_secret
from app.schemas.request import AgentRunRequest, AgentStopRequest
from app.agent.graph import agent_graph
from app.agent.state import AgentState
from app.agent.events import create_queue, remove_queue, emit, emit_done

# Import all tools to trigger registration
import app.tools.tavily_search      # noqa: F401
import app.tools.firecrawl_scrape   # noqa: F401
import app.tools.docling_parser     # noqa: F401
import app.tools.nanobana_imggen    # noqa: F401
import app.tools.image_annotate     # noqa: F401
import app.tools.vlm_understand     # noqa: F401
import app.tools.docmost_api        # noqa: F401

from app.tools.registry import get_tool_names

app = FastAPI(title="Docmost Agent Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active task tracking (for cancellation)
_active_tasks: dict[str, asyncio.Event] = {}
_task_counter = 0


@app.get("/health")
async def health():
    return {"status": "ok", "service": "docmost-agent"}


@app.get("/tools")
async def list_tools():
    return {"tools": get_tool_names()}


@app.post("/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent(request: AgentRunRequest):
    """运行 Agent，返回 SSE 事件流"""
    global _task_counter
    _task_counter += 1
    task_id = f"task-{_task_counter}"

    cancel_event = asyncio.Event()
    _active_tasks[task_id] = cancel_event

    # Create real-time event queue for this task
    queue = create_queue(task_id)

    initial_state: AgentState = {
        "user_message": request.user_message,
        "conversation_history": request.conversation_history,
        "uploaded_files": [f.model_dump() for f in request.files],
        "template_id": request.template_id,
        "page_id": request.page_context.page_id,
        "page_title": request.page_context.page_title,
        "page_content": request.page_context.page_content,
        "selected_text": request.page_context.selected_text,
        "selection_range": request.page_context.selection_range,
        "insert_mode": request.config.get("insert_mode", "create"),
        "plan": [],
        "current_step": 0,
        "research_results": [],
        "parsed_files": [],
        "generated_images": [],
        "draft_content": "",
        "final_content": "",
        "step_events": [],
        "needs_revision": False,
        "revision_feedback": "",
        "iteration_count": 0,
        "max_iterations": request.config.get("max_iterations", settings.agent_max_iterations),
        "_task_id": task_id,
    }

    async def run_graph():
        """Run the LangGraph in background; nodes push events to queue in real-time."""
        try:
            result = await agent_graph.ainvoke(initial_state)
            final_content = result.get("final_content", result.get("draft_content", ""))
            await emit(task_id, {
                "type": "done",
                "final_content": final_content,
                "insert_mode": request.config.get("insert_mode", "create"),
            })
        except Exception as e:
            await emit(task_id, {"type": "error", "message": str(e)[:500]})
        finally:
            await emit_done(task_id)
            _active_tasks.pop(task_id, None)

    # Start graph execution in background
    asyncio.create_task(run_graph())

    async def event_generator():
        """Read events from queue and yield as SSE."""
        try:
            while True:
                if cancel_event.is_set():
                    yield {"data": json.dumps({"type": "error", "message": "任务已取消"}, ensure_ascii=False)}
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if event is None:  # sentinel — graph finished
                    break
                yield {"data": json.dumps(event, ensure_ascii=False)}
        finally:
            remove_queue(task_id)

    return EventSourceResponse(event_generator(), headers={"X-Task-Id": task_id})


@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: AgentStopRequest):
    """终止正在运行的 Agent 任务"""
    cancel = _active_tasks.get(request.task_id)
    if cancel:
        cancel.set()
        return {"status": "stopping"}
    return {"status": "not_found"}
