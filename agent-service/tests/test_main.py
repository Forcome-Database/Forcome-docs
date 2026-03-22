import pytest
from httpx import ASGITransport, AsyncClient
from app import main as main_module
from app.main import app
from app.config import settings
from app.orchestrator.document_task_engine import DocumentTaskEngine
from app.orchestrator.persistence.postgres_session_store import PostgresSessionStore
from app.orchestrator.session_store import InMemoryRuntimeStore, SessionStore, session_store


@pytest.fixture(autouse=True)
def use_explicit_memory_session_backend():
    session_store.use_memory_backend()
    session_store.clear()
    yield
    session_store.use_memory_backend()
    session_store.clear()

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_agent_entrypoint_uses_document_task_engine():
    assert isinstance(main_module._orchestrator, DocumentTaskEngine)


@pytest.mark.asyncio
async def test_resume_returns_sse_error_when_no_pending_interaction():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/agent/resume",
            headers={"X-Internal-Secret": settings.agent_internal_secret},
            json={
                "session_id": "missing-thread",
                "resume_value": {"type": "skip_issue", "issue_id": "issue-1"},
            },
        )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert '"type": "error"' in resp.text
    assert "missing-thread" in resp.text


@pytest.mark.asyncio
async def test_resume_rejects_legacy_resume_payloads():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/agent/resume",
            headers={"X-Internal-Secret": settings.agent_internal_secret},
            json={"thread_id": "missing-thread", "resume_value": {"answers": "Legacy clarify"}},
        )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_session_snapshot_returns_current_creation_session():
    session_store.upsert_session(
        session_id="session-1",
        thread_id="thread-1",
        run_state="awaiting_input",
        phase="brief",
        pending_decision={
            "phase": "brief",
            "data": {
                "type": "brief",
                "brief": {
                    "audience": "engineers",
                    "goal": "Summarize the system",
                    "target_length": 1200,
                    "length_tolerance": 0.1,
                    "style": "technical",
                    "tone": "professional",
                    "structure_strategy": "ai_recommend",
                    "image_strategy": "none",
                    "constraints": [],
                },
            },
        },
        draft_markdown="# Draft",
        draft_sections=[
            {
                "node_id": "section:intro",
                "section_id": "intro",
                "title": "Intro",
                "level": 2,
                "content": "Draft body",
                "write_attempts": 2,
                "image_status": "generated",
                "source_image_asset_id": "img-source-1",
                "degraded_reason": "source asset unavailable",
            }
        ],
        evidence_summary={
            "total": 2,
            "required_total": 1,
            "optional_total": 1,
            "failed_required": 1,
        },
        failed_evidence_items=[
            {
                "kind": "reference_url",
                "source": "https://example.com/spec",
                "required": True,
                "status": "failed",
                "purpose": "ground the source document",
                "error": "crawl timeout",
            }
        ],
        block_resolution_choices=["retry", "remove_source"],
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/agent/session/session-1",
            headers={"X-Internal-Secret": settings.agent_internal_secret},
        )

    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ok",
        "session": {
            "session_id": "session-1",
            "thread_id": "thread-1",
            "run_state": "awaiting_input",
            "phase": "brief",
            "pending_decision": {
                "phase": "brief",
                "data": {
                    "type": "brief",
                    "brief": {
                        "audience": "engineers",
                        "goal": "Summarize the system",
                        "target_length": 1200,
                        "length_tolerance": 0.1,
                        "style": "technical",
                        "tone": "professional",
                        "structure_strategy": "ai_recommend",
                        "image_strategy": "none",
                        "constraints": [],
                    },
                },
            },
            "blocked": None,
            "brief": None,
            "blueprint": None,
            "pending_blueprint_patch": None,
            "blueprint_change_audit": [],
            "review_report": None,
            "draft_markdown": "# Draft",
            "draft_sections": [
                {
                    "node_id": "section:intro",
                    "section_id": "intro",
                    "title": "Intro",
                    "level": 2,
                    "content": "Draft body",
                    "write_attempts": 2,
                    "image_status": "generated",
                    "source_image_asset_id": "img-source-1",
                    "degraded_reason": "source asset unavailable",
                }
            ],
            "document_tree": None,
            "final_content": "",
            "last_error": None,
            "evidence_summary": {
                "total": 2,
                "required_total": 1,
                "optional_total": 1,
                "failed_required": 1,
            },
            "failed_evidence_items": [
                {
                    "kind": "reference_url",
                    "source": "https://example.com/spec",
                    "required": True,
                    "status": "failed",
                    "purpose": "ground the source document",
                    "error": "crawl timeout",
                }
            ],
            "block_resolution_choices": ["retry", "remove_source"],
        },
    }


@pytest.mark.asyncio
async def test_get_session_snapshot_survives_store_reconfiguration(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'sessions.db'}"
    persistent_snapshot_store = PostgresSessionStore(database_url=database_url)
    persistent_session_store = SessionStore(
        snapshot_repository=persistent_snapshot_store,
        runtime_store=InMemoryRuntimeStore(),
        backend="postgres_redis",
    )
    persistent_session_store.upsert_session(
        session_id="session-persisted",
        thread_id="thread-persisted",
        run_state="awaiting_input",
        phase="review",
        pending_decision={
            "phase": "review",
            "data": {
                "type": "review",
                "report": {
                    "overall_score": 88,
                    "issues": [],
                },
            },
        },
        blueprint={
            "title": "Doc",
            "sections": [{"id": "s1", "title": "Intro", "level": 2, "word_budget": 400}],
            "total_word_budget": 400,
        },
        document_tree={
            "root": {
                "node_id": "document:title",
                "title": "Doc",
                "level": 1,
                "content": "",
            },
            "sections": [
                {
                    "node_id": "section:s1",
                    "section_id": "s1",
                    "title": "Intro",
                    "level": 2,
                    "content": "Hello",
                }
            ],
        },
    )

    session_store.configure(
        snapshot_repository=PostgresSessionStore(database_url=database_url),
        runtime_store=InMemoryRuntimeStore(),
        backend="postgres_redis",
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/agent/session/session-persisted",
            headers={"X-Internal-Secret": settings.agent_internal_secret},
        )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "ok"
    assert payload["session"]["phase"] == "review"
    assert payload["session"]["pending_decision"]["phase"] == "review"
    assert payload["session"]["document_tree"]["sections"][0]["node_id"] == "section:s1"
