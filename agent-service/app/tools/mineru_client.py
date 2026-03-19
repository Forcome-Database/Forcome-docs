from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import settings


def _setting_value(name: str, default: Any = None) -> Any:
    env_value = os.getenv(name)
    if env_value is not None:
        return env_value
    return getattr(settings, name.lower(), default)


def _setting_str(name: str, default: str = "") -> str:
    value = _setting_value(name, default)
    return str(value or default)


def _setting_float(name: str, default: float) -> float:
    value = _setting_value(name, default)
    return float(value)


def _env_bool(name: str, default: bool = False) -> bool:
    value = _setting_value(name, None)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _model_version_for_filename(name: str) -> str:
    return "MinerU-HTML" if Path(name).suffix.lower() == ".html" else "vlm"


@dataclass(slots=True)
class MinerUConfig:
    enabled: bool = False
    base_url: str = "https://mineru.net"
    token: str = ""
    poll_interval_seconds: float = 2.0
    poll_timeout_seconds: float = 300.0

    @classmethod
    def from_env(cls) -> "MinerUConfig":
        return cls(
            enabled=_env_bool("MINERU_ENABLED", False),
            base_url=_setting_str("MINERU_API_BASE_URL", "https://mineru.net").rstrip("/"),
            token=_setting_str("MINERU_API_TOKEN", ""),
            poll_interval_seconds=_setting_float("MINERU_POLL_INTERVAL_SECONDS", 2.0),
            poll_timeout_seconds=_setting_float("MINERU_POLL_TIMEOUT_SECONDS", 300.0),
        )


@dataclass(slots=True)
class MinerUExtractResult:
    batch_id: str
    file_name: str
    state: str
    full_zip_url: str
    zip_bytes: bytes
    trace_id: str = ""
    err_msg: str = ""


class MinerUClient:
    def __init__(
        self,
        *,
        config: MinerUConfig | None = None,
        client: httpx.AsyncClient | Any | None = None,
    ) -> None:
        self.config = config or MinerUConfig.from_env()
        self._client = client or httpx.AsyncClient(timeout=self.config.poll_timeout_seconds)
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client and hasattr(self._client, "aclose"):
            await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        if not self.config.token:
            raise RuntimeError("MINERU_API_TOKEN is not configured")
        return {
            "Authorization": f"Bearer {self.config.token}",
            "Content-Type": "application/json",
        }

    async def request_upload_urls(
        self,
        *,
        name: str,
        is_ocr: bool = False,
        data_id: str | None = None,
    ) -> tuple[str, list[str], str]:
        payload: dict[str, Any] = {
            "files": [
                {
                    "name": name,
                    **({"data_id": data_id} if data_id else {}),
                }
            ],
            "model_version": _model_version_for_filename(name),
            "enable_formula": False,
            "enable_table": True,
            "is_ocr": is_ocr,
        }

        response = await self._client.post(
            f"{self.config.base_url}/api/v4/file-urls/batch",
            headers=self._headers(),
            json=payload,
        )
        response.raise_for_status()
        body = response.json()
        if body.get("code") not in {0, 200, "0", "200"}:
            raise RuntimeError(f"MinerU upload URL request failed: {body}")

        data = body.get("data") or {}
        urls = data.get("file_urls") or data.get("upload_urls") or []
        if isinstance(urls, dict):
            urls = list(urls.values())
        if not urls:
            raise RuntimeError(f"MinerU upload URL response missing file URLs: {body}")

        return str(data.get("batch_id") or ""), [str(url) for url in urls], str(body.get("trace_id") or "")

    async def upload_to_presigned_url(self, url: str, content: bytes) -> None:
        response = await self._client.put(url, content=content)
        response.raise_for_status()

    async def poll_batch_result(
        self,
        *,
        batch_id: str,
        file_name: str,
    ) -> tuple[dict[str, Any], str]:
        deadline = time.monotonic() + self.config.poll_timeout_seconds
        last_entry: dict[str, Any] | None = None
        last_trace_id = ""

        while time.monotonic() < deadline:
            response = await self._client.get(
                f"{self.config.base_url}/api/v4/extract-results/batch/{batch_id}",
                headers={"Authorization": f"Bearer {self.config.token}"},
            )
            response.raise_for_status()
            body = response.json()
            if body.get("code") not in {0, 200, "0", "200"}:
                raise RuntimeError(f"MinerU polling failed: {body}")

            last_trace_id = str(body.get("trace_id") or "")
            data = body.get("data") or {}
            results = data.get("extract_result") or []
            entry = next(
                (item for item in results if str(item.get("file_name") or "") == file_name),
                results[0] if results else None,
            )
            if entry:
                last_entry = entry
                state = str(entry.get("state") or "").lower()
                if state in {"done", "success"}:
                    return entry, last_trace_id
                if state in {"failed", "error"}:
                    raise RuntimeError(str(entry.get("err_msg") or "MinerU extraction failed"))

            await asyncio.sleep(self.config.poll_interval_seconds)

        raise TimeoutError(f"Timed out waiting for MinerU batch {batch_id}: {last_entry}")

    async def download_zip(self, url: str) -> bytes:
        response = await self._client.get(url)
        response.raise_for_status()
        return bytes(response.content)

    async def extract_file(
        self,
        *,
        name: str,
        content: bytes,
        is_ocr: bool = False,
        data_id: str | None = None,
    ) -> MinerUExtractResult:
        batch_id, upload_urls, trace_id = await self.request_upload_urls(
            name=name,
            is_ocr=is_ocr,
            data_id=data_id,
        )
        if not batch_id:
            raise RuntimeError("MinerU response missing batch_id")

        await self.upload_to_presigned_url(upload_urls[0], content)
        entry, poll_trace_id = await self.poll_batch_result(batch_id=batch_id, file_name=name)
        full_zip_url = str(entry.get("full_zip_url") or "")
        if not full_zip_url:
            raise RuntimeError(f"MinerU finished without full_zip_url: {entry}")
        zip_bytes = await self.download_zip(full_zip_url)

        return MinerUExtractResult(
            batch_id=batch_id,
            file_name=name,
            state=str(entry.get("state") or "done"),
            full_zip_url=full_zip_url,
            zip_bytes=zip_bytes,
            trace_id=poll_trace_id or trace_id,
            err_msg=str(entry.get("err_msg") or ""),
        )
