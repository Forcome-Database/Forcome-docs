import pytest

from app.agent.nodes import explorer


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def post(self, *args, **kwargs):
        return self._response


@pytest.mark.asyncio
async def test_upload_image_to_docmost_accepts_201_created(monkeypatch):
    monkeypatch.setattr(
        explorer.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(
            _FakeResponse(
                201,
                {
                    "data": {
                        "url": "/api/files/file-1/generated-1.png",
                    }
                },
            )
        ),
    )

    result = await explorer._upload_image_to_docmost(
        "abc123",
        "generated-1.png",
        "page-1",
    )

    assert result == "/api/files/file-1/generated-1.png"
