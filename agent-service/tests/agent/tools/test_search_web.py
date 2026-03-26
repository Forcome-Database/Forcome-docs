import pytest
from unittest.mock import patch, MagicMock
from app.agent.tools.search_web import search_web_impl


@pytest.mark.asyncio
async def test_returns_results():
    mock_fn = MagicMock(return_value="**Title**\nContent here\nURL: http://example.com")
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.tavily_search.tavily_search", mock_tool):
        result = await search_web_impl("python tutorial")
    assert "[Search Results" in result
    assert "Title" in result


@pytest.mark.asyncio
async def test_no_results():
    mock_fn = MagicMock(return_value="")
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.tavily_search.tavily_search", mock_tool):
        result = await search_web_impl("obscure query xyz")
    assert "[No Results]" in result
