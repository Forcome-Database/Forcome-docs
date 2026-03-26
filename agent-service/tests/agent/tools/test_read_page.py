import pytest
from unittest.mock import patch, MagicMock
from app.agent.tools.read_page import read_page_impl


@pytest.mark.asyncio
async def test_returns_content():
    mock_fn = MagicMock(return_value="# Page Title\n\nPage content here.")
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.docmost_api.docmost_page_read", mock_tool):
        result = await read_page_impl("page-uuid-123")
    assert "[Page:" in result
    assert "Page Title" in result


@pytest.mark.asyncio
async def test_truncates_long_content():
    mock_fn = MagicMock(return_value="x" * 20000)
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.docmost_api.docmost_page_read", mock_tool):
        result = await read_page_impl("page-id")
    assert "[Truncated" in result
