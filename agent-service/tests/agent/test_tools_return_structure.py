"""验证所有 v2 工具返回结构化 dict。"""
import pytest
from unittest.mock import patch
from app.agent.deps import AgentDeps


def _make_deps(**overrides) -> AgentDeps:
    defaults = dict(
        thread_id="test", page_id="page-1", workspace_id="ws-1",
        user_id="user-1", docmost_base_url="http://localhost:3000",
        internal_secret="secret",
    )
    defaults.update(overrides)
    return AgentDeps(**defaults)


@pytest.mark.asyncio
async def test_scrape_url_returns_dict():
    from app.agent.tools.scrape_url import scrape_url_impl
    with patch("app.agent.tools.scrape_url._get_firecrawl_fn",
               return_value=lambda url: "Hello World content " * 10):
        result = await scrape_url_impl("https://example.com")
    assert isinstance(result, dict)
    assert result["status"] == "success"
    assert "content" in result
    assert "word_count" in result


@pytest.mark.asyncio
async def test_search_web_returns_dict():
    from app.agent.tools.search_web import search_web_impl
    with patch("app.agent.tools.search_web._get_tavily_fn",
               return_value=lambda query: "Result 1: Something relevant " * 5):
        result = await search_web_impl("test query")
    assert isinstance(result, dict)
    assert result["status"] == "success"
    assert "results" in result


@pytest.mark.asyncio
async def test_scrape_url_error_returns_dict():
    from app.agent.tools.scrape_url import scrape_url_impl
    result = await scrape_url_impl("not-a-url")
    assert isinstance(result, dict)
    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_extract_document_no_files_returns_dict():
    from app.agent.tools.extract_document import extract_document_impl
    deps = _make_deps(files=[])
    result = await extract_document_impl(deps)
    assert isinstance(result, dict)
    assert result["status"] == "error"
