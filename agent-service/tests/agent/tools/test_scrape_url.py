import pytest
from unittest.mock import patch, MagicMock
from app.agent.tools.scrape_url import scrape_url_impl


@pytest.mark.asyncio
async def test_returns_content():
    long_content = "Page content about Python programming language. " * 5
    mock_fn = MagicMock(return_value=long_content)
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.firecrawl_scrape.firecrawl_scrape", mock_tool):
        result = await scrape_url_impl("https://example.com")
    assert result["status"] == "success"
    assert "Page content" in result["content"]


@pytest.mark.asyncio
async def test_invalid_url():
    result = await scrape_url_impl("not-a-url")
    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_empty_content():
    mock_fn = MagicMock(return_value="")
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.firecrawl_scrape.firecrawl_scrape", mock_tool):
        result = await scrape_url_impl("https://example.com")
    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_truncates_long_content():
    mock_fn = MagicMock(return_value="x" * 20000)
    mock_tool = MagicMock()
    mock_tool.func = mock_fn
    with patch("app.tools.firecrawl_scrape.firecrawl_scrape", mock_tool):
        result = await scrape_url_impl("https://example.com")
    assert result["truncated"] is True
    assert len(result["content"]) < 12000
