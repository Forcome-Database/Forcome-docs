import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException


def _make_request(secret_header: str | None) -> MagicMock:
    req = MagicMock()
    headers = {}
    if secret_header is not None:
        headers["X-Internal-Secret"] = secret_header
    req.headers = headers
    return req


@pytest.mark.asyncio
async def test_rejects_missing_header():
    """No header → 401"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request(None)
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = "real-secret"
        with pytest.raises(HTTPException) as exc:
            await verify_internal_secret(req)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_empty_secret_config():
    """Empty env + empty header → 401 (not bypass)"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request("")
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = ""
        with pytest.raises(HTTPException) as exc:
            await verify_internal_secret(req)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_wrong_secret():
    """Wrong secret → 401"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request("wrong")
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = "correct"
        with pytest.raises(HTTPException) as exc:
            await verify_internal_secret(req)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_correct_secret():
    """Correct secret → pass"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request("my-secret")
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = "my-secret"
        await verify_internal_secret(req)  # no exception
