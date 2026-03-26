"""测试 extract_document 工具。"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.agent.tools.extract_document import extract_document_impl
from app.agent.deps import AgentDeps


@pytest.fixture
def deps_with_file():
    return AgentDeps(
        thread_id="t1", page_id="page-1", workspace_id="ws-1",
        user_id="u1", docmost_base_url="http://localhost:3000",
        internal_secret="secret",
        files=[{"content_b64": "dGVzdA==", "filename": "test.pdf", "mimetype": "application/pdf"}],
    )


@pytest.fixture
def deps_no_files():
    return AgentDeps(
        thread_id="t", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://localhost:3000", internal_secret="s",
    )


@pytest.mark.asyncio
async def test_no_files_returns_message(deps_no_files):
    result = await extract_document_impl(deps_no_files)
    assert "[No Files]" in result


@pytest.mark.asyncio
async def test_returns_document_content(deps_with_file):
    mock_am = MagicMock()
    mock_am.source_markdown = "# Test\nContent here"
    mock_am.items = []
    with patch("app.workers.asset_parser.parse_document", return_value=mock_am):
        result = await extract_document_impl(deps_with_file)
    assert "[Document Content]" in result
    assert "Test" in result


@pytest.mark.asyncio
async def test_handles_parse_error(deps_with_file):
    with patch(
        "app.workers.asset_parser.parse_document",
        side_effect=RuntimeError("parse failed"),
    ):
        result = await extract_document_impl(deps_with_file)
    assert "[Error]" in result
