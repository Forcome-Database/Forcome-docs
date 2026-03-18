import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.config import settings
from app.orchestrator.session_store import session_store

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


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
            "review_report": None,
            "draft_markdown": "# Draft",
            "draft_sections": [],
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
