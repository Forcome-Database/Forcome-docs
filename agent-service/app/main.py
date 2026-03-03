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

@app.get("/health")
async def health():
    return {"status": "ok", "service": "docmost-agent"}

@app.get("/tools")
async def list_tools():
    return {"tools": get_tool_names()}

@app.post("/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent(request: AgentRunRequest):
    """运行 Agent，返回 SSE 事件流"""
    cancel_event = asyncio.Event()
    task_id = f"task-{id(cancel_event)}"
    _active_tasks[task_id] = cancel_event

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
    }

    async def event_generator():
        last_event_idx = 0
        try:
            async for state_update in agent_graph.astream(initial_state):
                if cancel_event.is_set():
                    yield {"data": json.dumps({"type": "error", "message": "任务已取消"}, ensure_ascii=False)}
                    break

                for node_name, node_output in state_update.items():
                    events = node_output.get("step_events", [])
                    new_events = events[last_event_idx:]
                    last_event_idx = len(events)
                    for evt in new_events:
                        yield {"data": json.dumps(evt, ensure_ascii=False)}

            # Send final done event with the content
            # We need to get the final state - extract final_content from the last update
            final_content = ""
            # The last state_update from the reviewer should have final_content
            if state_update:
                for node_name, node_output in state_update.items():
                    if "final_content" in node_output:
                        final_content = node_output["final_content"]

            yield {"data": json.dumps({
                "type": "done",
                "final_content": final_content,
                "insert_mode": request.config.get("insert_mode", "create"),
            }, ensure_ascii=False)}

        except Exception as e:
            yield {"data": json.dumps({"type": "error", "message": str(e)[:500]}, ensure_ascii=False)}
        finally:
            _active_tasks.pop(task_id, None)

    return EventSourceResponse(event_generator(), headers={"X-Task-Id": task_id})

@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: AgentStopRequest):
    """终止正在运行的 Agent 任务"""
    cancel = _active_tasks.get(request.task_id)
    if cancel:
        cancel.set()
        return {"status": "stopping"}
    return {"status": "not_found"}
