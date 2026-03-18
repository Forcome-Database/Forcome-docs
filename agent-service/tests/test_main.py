import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.config import settings

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
            json={"thread_id": "missing-thread", "resume_value": {"type": "review", "skip": True}},
        )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert '"type": "error"' in resp.text
    assert "missing-thread" in resp.text
