from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock, patch

import pytest

from app.tools.mineru_client import MinerUClient, MinerUConfig, settings


@dataclass
class FakeResponse:
    status_code: int = 200
    json_data: dict | None = None
    content: bytes = b""
    text: str = ""

    def json(self) -> dict:
        return self.json_data or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


@dataclass
class FakeAsyncClient:
    post_responses: list[FakeResponse] = field(default_factory=list)
    put_responses: list[FakeResponse] = field(default_factory=list)
    get_responses: list[FakeResponse] = field(default_factory=list)
    calls: list[tuple[str, str, dict]] = field(default_factory=list)

    async def post(self, url: str, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.post_responses.pop(0)

    async def put(self, url: str, **kwargs):
        self.calls.append(("PUT", url, kwargs))
        return self.put_responses.pop(0)

    async def get(self, url: str, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.get_responses.pop(0)

    async def aclose(self) -> None:
        return None


def test_mineru_config_reads_env(monkeypatch):
    monkeypatch.setenv("MINERU_ENABLED", "true")
    monkeypatch.setenv("MINERU_API_BASE_URL", "https://mineru.net")
    monkeypatch.setenv("MINERU_API_TOKEN", "secret")
    monkeypatch.setenv("MINERU_POLL_INTERVAL_SECONDS", "1.5")
    monkeypatch.setenv("MINERU_POLL_TIMEOUT_SECONDS", "90")

    config = MinerUConfig.from_env()

    assert config.enabled is True
    assert config.base_url == "https://mineru.net"
    assert config.token == "secret"
    assert config.poll_interval_seconds == 1.5
    assert config.poll_timeout_seconds == 90.0


def test_mineru_config_reads_settings_when_process_env_is_missing(monkeypatch):
    monkeypatch.delenv("MINERU_ENABLED", raising=False)
    monkeypatch.delenv("MINERU_API_BASE_URL", raising=False)
    monkeypatch.delenv("MINERU_API_TOKEN", raising=False)
    monkeypatch.delenv("MINERU_POLL_INTERVAL_SECONDS", raising=False)
    monkeypatch.delenv("MINERU_POLL_TIMEOUT_SECONDS", raising=False)

    with (
        patch.object(settings, "mineru_enabled", True),
        patch.object(settings, "mineru_api_base_url", "https://mineru.example.com"),
        patch.object(settings, "mineru_api_token", "settings-secret"),
        patch.object(settings, "mineru_poll_interval_seconds", 0.5),
        patch.object(settings, "mineru_poll_timeout_seconds", 45.0),
    ):
        config = MinerUConfig.from_env()

    assert config.enabled is True
    assert config.base_url == "https://mineru.example.com"
    assert config.token == "settings-secret"
    assert config.poll_interval_seconds == 0.5
    assert config.poll_timeout_seconds == 45.0


@pytest.mark.asyncio
async def test_extract_file_uploads_polls_and_downloads_zip():
    client = FakeAsyncClient(
        post_responses=[
            FakeResponse(
                json_data={
                    "code": 0,
                    "trace_id": "trace-1",
                    "data": {
                        "batch_id": "batch-1",
                        "file_urls": ["https://upload.example.com/demo.pdf"],
                    },
                }
            )
        ],
        put_responses=[FakeResponse(status_code=200)],
        get_responses=[
            FakeResponse(
                json_data={
                    "code": 0,
                    "trace_id": "trace-2",
                    "data": {
                        "batch_id": "batch-1",
                        "extract_result": [
                            {
                                "file_name": "demo.pdf",
                                "state": "running",
                                "err_msg": "",
                            }
                        ],
                    },
                }
            ),
            FakeResponse(
                json_data={
                    "code": 0,
                    "trace_id": "trace-3",
                    "data": {
                        "batch_id": "batch-1",
                        "extract_result": [
                            {
                                "file_name": "demo.pdf",
                                "state": "done",
                                "err_msg": "",
                                "full_zip_url": "https://download.example.com/demo.zip",
                            }
                        ],
                    },
                }
            ),
            FakeResponse(content=b"PK\x03\x04zip-bytes"),
        ],
    )
    mineru = MinerUClient(
        config=MinerUConfig(
            enabled=True,
            base_url="https://mineru.net",
            token="secret",
            poll_interval_seconds=0.01,
            poll_timeout_seconds=1.0,
        ),
        client=client,
    )

    with patch("app.tools.mineru_client.asyncio.sleep", new=AsyncMock()) as sleep_mock:
        result = await mineru.extract_file(name="demo.pdf", content=b"%PDF-1.7")

    assert result.batch_id == "batch-1"
    assert result.file_name == "demo.pdf"
    assert result.state == "done"
    assert result.full_zip_url == "https://download.example.com/demo.zip"
    assert result.zip_bytes == b"PK\x03\x04zip-bytes"
    assert sleep_mock.await_count == 1
    assert client.calls[0][0:2] == ("POST", "https://mineru.net/api/v4/file-urls/batch")
    assert client.calls[1][0:2] == ("PUT", "https://upload.example.com/demo.pdf")
    assert client.calls[-1][0:2] == ("GET", "https://download.example.com/demo.zip")
