"""Test the /agent/v2/run endpoint."""
import json
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from fastapi import FastAPI


@pytest.fixture
def app_with_mocked_auth():
    """Create app with mocked auth dependency."""
    from app.main import app
    from app.middleware.auth import verify_internal_secret

    # Override the dependency
    def mock_verify_internal_secret():
        return None

    app.dependency_overrides[verify_internal_secret] = mock_verify_internal_secret
    yield app
    # Clean up
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_v2_run_returns_sse(app_with_mocked_auth):
    """v2 endpoint should return SSE stream."""
    app = app_with_mocked_auth

    # Mock run_agent to yield simple events
    async def mock_run_agent(user_message, deps, *, multimodal_parts=None):
        yield {"type": "content", "chunk": "Hello"}
        yield {"type": "done"}

    with patch("app.main._run_agent", side_effect=mock_run_agent):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/agent/v2/run",
                json={
                    "prompt": "test prompt",
                    "workspace_id": "ws1",
                    "user_id": "u1",
                },
                headers={"X-Internal-Secret": "test-secret"},
            )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

        # Parse SSE stream
        lines = response.text.strip().split("\n")
        events = []
        for line in lines:
            if line.startswith("data: "):
                try:
                    event_data = json.loads(line[6:])
                    events.append(event_data)
                except json.JSONDecodeError:
                    pass

        # Check first event is session
        assert events[0]["type"] == "session"
        assert "thread_id" in events[0]


@pytest.mark.asyncio
async def test_v2_run_thread_id_auto_generated(app_with_mocked_auth):
    """v2 endpoint should auto-generate thread_id if not provided."""
    app = app_with_mocked_auth

    captured_deps = []

    async def mock_run_agent(user_message, deps, *, multimodal_parts=None):
        captured_deps.append(deps)
        yield {"type": "done"}

    with patch("app.main._run_agent", side_effect=mock_run_agent):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/agent/v2/run",
                json={
                    "prompt": "test",
                    "workspace_id": "ws1",
                    "user_id": "u1",
                },
                headers={"X-Internal-Secret": "test-secret"},
            )

        assert response.status_code == 200
        assert len(captured_deps) == 1
        # thread_id should be generated (UUID-like)
        assert len(captured_deps[0].thread_id) > 0


@pytest.mark.asyncio
async def test_v2_run_preserves_thread_id(app_with_mocked_auth):
    """v2 endpoint should preserve provided thread_id."""
    app = app_with_mocked_auth

    captured_deps = []

    async def mock_run_agent(user_message, deps, *, multimodal_parts=None):
        captured_deps.append(deps)
        yield {"type": "done"}

    with patch("app.main._run_agent", side_effect=mock_run_agent):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/agent/v2/run",
                json={
                    "prompt": "test",
                    "thread_id": "custom-thread-123",
                    "workspace_id": "ws1",
                    "user_id": "u1",
                },
                headers={"X-Internal-Secret": "test-secret"},
            )

        assert response.status_code == 200
        assert len(captured_deps) == 1
        assert captured_deps[0].thread_id == "custom-thread-123"


@pytest.mark.asyncio
async def test_v2_run_passes_files(app_with_mocked_auth):
    """v2 endpoint should pass files to AgentDeps."""
    app = app_with_mocked_auth

    captured_deps = []

    async def mock_run_agent(user_message, deps, *, multimodal_parts=None):
        captured_deps.append(deps)
        yield {"type": "done"}

    test_files = [
        {"content_b64": "dGVzdA==", "filename": "test.txt", "mimetype": "text/plain"},
    ]

    with patch("app.main._run_agent", side_effect=mock_run_agent):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/agent/v2/run",
                json={
                    "prompt": "test",
                    "workspace_id": "ws1",
                    "user_id": "u1",
                    "files": test_files,
                },
                headers={"X-Internal-Secret": "test-secret"},
            )

        assert response.status_code == 200
        assert len(captured_deps) == 1
        assert captured_deps[0].files == test_files


@pytest.mark.asyncio
async def test_v2_run_multimodal_only_images(app_with_mocked_auth):
    """v2 endpoint should only pass image files as BinaryContent multimodal_parts.

    Document files (PDF/DOCX/PPTX) must NOT be multimodal — they go through
    extract_document tool → MinerU for proper text + image extraction.
    """
    app = app_with_mocked_auth

    captured_kwargs = []

    async def mock_run_agent(user_message, deps, *, multimodal_parts=None):
        captured_kwargs.append({"multimodal_parts": multimodal_parts})
        yield {"type": "done"}

    # Mix of document and image files
    test_files = [
        {"content_b64": "dGVzdA==", "filename": "doc.docx", "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        {"content_b64": "iVBORw0KGgo=", "filename": "photo.png", "mimetype": "image/png"},
        {"content_b64": "dGVzdA==", "filename": "slides.pptx", "mimetype": "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    ]

    with patch("app.main._run_agent", side_effect=mock_run_agent):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/agent/v2/run",
                json={
                    "prompt": "test",
                    "workspace_id": "ws1",
                    "user_id": "u1",
                    "files": test_files,
                },
                headers={"X-Internal-Secret": "test-secret"},
            )

        assert response.status_code == 200
        assert len(captured_kwargs) == 1
        # Only the PNG image should be in multimodal_parts (not DOCX or PPTX)
        multimodal = captured_kwargs[0]["multimodal_parts"]
        assert multimodal is not None
        assert len(multimodal) == 1
        from pydantic_ai.messages import BinaryContent
        assert isinstance(multimodal[0], BinaryContent)
        assert multimodal[0].media_type == "image/png"
