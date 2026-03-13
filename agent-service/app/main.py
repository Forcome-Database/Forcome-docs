import asyncio
import json
import sys
from contextlib import asynccontextmanager
from uuid import uuid4

import psycopg
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from psycopg_pool import AsyncConnectionPool
from sse_starlette.sse import EventSourceResponse

from app.agent.cancellation import (
    AgentCancelledError,
    cancel_task,
    register_task,
    unregister_task,
)
from app.agent.document_strategy import empty_document_plan
from app.agent.events import create_queue, emit, emit_done, remove_queue
from app.agent.graph import agent_graph_builder
from app.agent.state import AgentState
from app.config import settings
from app.middleware.auth import verify_internal_secret
from app.schemas.request import AgentResumeRequest, AgentRunRequest, AgentStopRequest

# Import all tools to trigger registration.
import app.tools.docling_parser  # noqa: F401
import app.tools.docmost_api  # noqa: F401
import app.tools.firecrawl_scrape  # noqa: F401
import app.tools.image_annotate  # noqa: F401
import app.tools.nanobana_imggen  # noqa: F401
import app.tools.tavily_search  # noqa: F401
import app.tools.vlm_understand  # noqa: F401
from app.tools.registry import get_tool_names

# Windows psycopg async requires SelectorEventLoop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

_compiled_graph = None
_checkpointer = None
_pool = None
_task_counter = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Set up PostgreSQL pool and LangGraph checkpointer."""
    global _compiled_graph, _checkpointer, _pool

    if settings.database_url:
        db_url = settings.database_url.split("?")[0]

        async with await psycopg.AsyncConnection.connect(
            db_url,
            autocommit=True,
        ) as setup_conn:
            setup_saver = AsyncPostgresSaver(setup_conn)
            await setup_saver.setup()

        _pool = AsyncConnectionPool(
            conninfo=db_url,
            open=False,
        )
        await _pool.open()

        _checkpointer = AsyncPostgresSaver(_pool)
        _compiled_graph = agent_graph_builder.compile(checkpointer=_checkpointer)
    else:
        _compiled_graph = agent_graph_builder.compile()

    yield

    if _pool:
        await _pool.close()


app = FastAPI(title="Docmost Agent Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "docmost-agent"}


@app.get("/tools")
async def list_tools():
    return {"tools": get_tool_names()}


async def _run_graph_with_stream(
    *,
    task_id: str,
    thread_id: str,
    graph_input,
    config: dict,
    insert_mode: str,
):
    try:
        result = await _compiled_graph.ainvoke(graph_input, config=config)

        state_snapshot = await _compiled_graph.aget_state(config)
        if state_snapshot.next:
            for interrupt_state in state_snapshot.interrupts:
                data = interrupt_state.value
                phase = data.get("type", "unknown") if isinstance(data, dict) else "unknown"
                await emit(
                    thread_id,
                    {
                        "type": "await_input",
                        "phase": phase,
                        "data": data if isinstance(data, dict) else {},
                    },
                )
                break
        else:
            final_content = result.get("final_content", result.get("draft_content", ""))
            await emit(
                thread_id,
                {
                    "type": "done",
                    "final_content": final_content,
                    "insert_mode": result.get("insert_mode", insert_mode),
                },
            )
    except AgentCancelledError:
        await emit(thread_id, {"type": "cancelled"})
    except Exception as exc:  # pragma: no cover - surfaced as stream error
        await emit(thread_id, {"type": "error", "message": str(exc)[:500]})
    finally:
        await emit_done(thread_id)
        unregister_task(task_id, thread_id)


async def _event_generator(thread_id: str, queue: asyncio.Queue):
    yield {"data": json.dumps({"type": "session", "thread_id": thread_id}, ensure_ascii=False)}
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            if event is None:
                break

            yield {"data": json.dumps(event, ensure_ascii=False)}
    finally:
        remove_queue(thread_id)


@app.post("/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent(request: AgentRunRequest):
    global _task_counter
    _task_counter += 1
    task_id = f"task-{_task_counter}"

    thread_id = request.thread_id or str(uuid4())
    register_task(task_id, thread_id)
    queue = create_queue(thread_id)

    initial_state: AgentState = {
        "user_message": request.user_message,
        "conversation_history": request.conversation_history,
        "uploaded_files": [file.model_dump() for file in request.files],
        "template_id": request.template_id,
        "workspace_id": request.workspace_id,
        "system_prompt": request.system_prompt,
        "template_prompt": request.template_prompt,
        "document_strategy": request.document_strategy or {},
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
        "max_iterations": request.config.get(
            "max_iterations",
            settings.agent_max_iterations,
        ),
        "clarify_questions": [],
        "user_answers": "",
        "proposals": [],
        "selected_proposal": {},
        "outline": "",
        "confirmed_outline": "",
        "document_plan": empty_document_plan(request.document_strategy),
        "phase": "explorer",
        "_task_id": task_id,
        "_thread_id": thread_id,
    }

    config = {"configurable": {"thread_id": thread_id}}

    asyncio.create_task(
        _run_graph_with_stream(
            task_id=task_id,
            thread_id=thread_id,
            graph_input=initial_state,
            config=config,
            insert_mode=request.config.get("insert_mode", "create"),
        )
    )

    return EventSourceResponse(
        _event_generator(thread_id, queue),
        headers={"X-Task-Id": task_id},
    )


@app.post("/agent/resume", dependencies=[Depends(verify_internal_secret)])
async def resume_agent(request: AgentResumeRequest):
    global _task_counter
    _task_counter += 1
    task_id = f"task-{_task_counter}"

    thread_id = request.thread_id
    register_task(task_id, thread_id)
    queue = create_queue(thread_id)

    config = {"configurable": {"thread_id": thread_id}}

    asyncio.create_task(
        _run_graph_with_stream(
            task_id=task_id,
            thread_id=thread_id,
            graph_input=Command(resume=request.resume_value),
            config=config,
            insert_mode="create",
        )
    )

    return EventSourceResponse(
        _event_generator(thread_id, queue),
        headers={"X-Task-Id": task_id},
    )


@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: AgentStopRequest):
    if cancel_task(request.task_id):
        return {"status": "stopping"}
    return {"status": "not_found"}
