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
from app.agent.events import create_queue, emit, emit_done, remove_queue
from app.config import settings
from app.middleware.auth import verify_internal_secret
from app.schemas.request import AgentResumeRequest, AgentStopRequest

# Windows asyncio requires SelectorEventLoop for compatibility with some async libs.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

_task_counter = 0


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


# ── Orchestrator Endpoints ────────────────────────────────────────────

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest
from app.orchestrator.session_store import session_store
from app.orchestrator.tools.user_interaction import interaction_registry

_orchestrator = OrchestratorEngine()


async def _event_generator(thread_id: str, queue: asyncio.Queue):
    yield {
        "data": json.dumps(
            {"type": "session", "session_id": thread_id, "thread_id": thread_id},
            ensure_ascii=False,
        )
    }
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            if event is None:
                break

            yield {"data": json.dumps(event, ensure_ascii=False)}
            if event.get("type") == "await_input":
                break
    finally:
        remove_queue(thread_id)


async def _single_event_stream(event: dict):
    yield {"data": json.dumps(event, ensure_ascii=False)}


def _normalize_resume_value_for_engine(request: AgentResumeRequest) -> dict:
    resume_value = request.resume_value

    if resume_value.type == "confirm_brief":
        return {"brief": resume_value.brief}

    if resume_value.type in {"confirm_blueprint", "apply_blueprint_patch"}:
        return {
            "blueprint": resume_value.blueprint,
            **({"feedback": resume_value.feedback} if getattr(resume_value, "feedback", None) else {}),
        }

    if resume_value.type == "fix_selected_issues":
        return {
            "selected_issue_ids": resume_value.selected_issue_ids,
            **({"feedback": resume_value.feedback} if resume_value.feedback else {}),
        }

    if resume_value.type == "resolve_block":
        return {
            "resolution": resume_value.resolution,
            "context": resume_value.context,
        }

    if resume_value.type == "skip_issue":
        return {
            "skip": True,
            "selected_issue_ids": [resume_value.issue_id],
            **({"feedback": resume_value.feedback} if resume_value.feedback else {}),
        }

    return {}


async def _run_orchestrator_with_stream(
    *,
    task_id: str,
    thread_id: str,
    request: OrchestratorRequest,
):
    try:
        await _orchestrator.run(request)
    except AgentCancelledError:
        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            run_state="cancelled",
            phase="cancelled",
            pending_decision=None,
            blocked=None,
        )
        await emit(thread_id, {"type": "cancelled"})
    except Exception as exc:
        session_store.upsert_session(
            session_id=thread_id,
            thread_id=thread_id,
            run_state="error",
            phase="error",
            pending_decision=None,
            blocked=None,
            last_error=str(exc)[:500],
        )
        await emit(thread_id, {"type": "error", "message": str(exc)[:500]})
    finally:
        await emit_done(thread_id)
        unregister_in_memory_task(task_id, thread_id)
        session_store.unregister_run(task_id=task_id, thread_id=thread_id)
        interaction_registry.cleanup(thread_id)


@app.post("/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent(request: dict):
    global _task_counter
    _task_counter += 1
    task_id = f"task-{_task_counter}"
    thread_id = request.get("thread_id") or str(uuid4())
    session_store.upsert_session(
        session_id=thread_id,
        thread_id=thread_id,
        run_state="running",
        phase="init",
        pending_decision=None,
        blocked=None,
        last_error=None,
        block_resolution_choices=[],
    )

    register_in_memory_task(task_id, thread_id)
    session_store.register_run(task_id=task_id, thread_id=thread_id)
    queue = create_queue(thread_id)

    orch_request = OrchestratorRequest(
        user_message=request.get("user_message", ""),
        thread_id=thread_id,
        workspace_id=request.get("workspace_id", ""),
        page_id=request.get("page_id"),
        page_title=request.get("page_title"),
        page_content=request.get("page_content"),
        selected_text=request.get("selected_text"),
        intent_route=request.get("intent_route", "document_create"),
        insert_mode=request.get("insert_mode", "create"),
        files=request.get("files", []),
        template_id=request.get("template_id"),
        system_prompt=request.get("system_prompt"),
        template_prompt=request.get("template_prompt"),
        conversation_history=request.get("conversation_history", []),
    )

    asyncio.create_task(
        _run_orchestrator_with_stream(
            task_id=task_id,
            thread_id=thread_id,
            request=orch_request,
        )
    )

    return EventSourceResponse(
        _event_generator(thread_id, queue),
        headers={"X-Task-Id": task_id},
    )


@app.post("/agent/resume", dependencies=[Depends(verify_internal_secret)])
async def resume_agent(request: AgentResumeRequest):
    thread_id = request.session_id
    resume_value = _normalize_resume_value_for_engine(request)

    queue = create_queue(thread_id)
    ok = interaction_registry.submit_response(thread_id, resume_value)
    if not ok:
        remove_queue(thread_id)
        return EventSourceResponse(
            _single_event_stream(
                {
                    "type": "error",
                    "message": f"No pending interaction for thread {thread_id}",
                }
            )
        )
    session_store.upsert_session(
        session_id=thread_id,
        thread_id=thread_id,
        run_state="running",
        pending_decision=None,
        blocked=None,
        block_resolution_choices=[],
    )
    return EventSourceResponse(_event_generator(thread_id, queue))


@app.get("/agent/session/{session_id}", dependencies=[Depends(verify_internal_secret)])
async def get_agent_session(session_id: str):
    session = session_store.get_session(session_id)
    if not session:
        return {"status": "not_found"}
    return {"status": "ok", "session": session.model_dump()}


@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: AgentStopRequest):
    in_memory_cancelled = cancel_in_memory_task(request.task_id)
    runtime_cancelled = session_store.cancel_task(request.task_id)
    if in_memory_cancelled or runtime_cancelled:
        return {"status": "stopping"}
    return {"status": "not_found"}


# ── Draft Management Endpoints ────────────────────────────────────
from app.orchestrator.draft_manager import draft_store


@app.post("/v2/draft/get", dependencies=[Depends(verify_internal_secret)])
async def get_draft(request: dict):
    draft = draft_store.get_draft(
        workspace_id=request.get("workspace_id", ""),
        page_id=request.get("page_id", ""),
        task_id=request.get("task_id", ""),
    )
    if not draft:
        return {"status": "not_found"}
    return {"status": "ok", "draft": draft}


@app.post("/v2/draft/merge", dependencies=[Depends(verify_internal_secret)])
async def get_merged_draft(request: dict):
    content = draft_store.get_merged_content(
        workspace_id=request.get("workspace_id", ""),
        page_id=request.get("page_id", ""),
        task_id=request.get("task_id", ""),
    )
    return {"status": "ok", "content": content}


@app.post("/v2/draft/delete", dependencies=[Depends(verify_internal_secret)])
async def delete_draft(request: dict):
    ok = draft_store.delete_draft(
        workspace_id=request.get("workspace_id", ""),
        page_id=request.get("page_id", ""),
        task_id=request.get("task_id", ""),
    )
    return {"status": "deleted" if ok else "not_found"}
