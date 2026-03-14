"""Tests for Researcher Worker and research orchestrator tool."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.workers.researcher as researcher_module
from app.workers.researcher import research


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tool_mock(return_value: str) -> MagicMock:
    """Create a mock tool with an .invoke() method."""
    mock = MagicMock()
    mock.invoke.return_value = return_value
    return mock


# ---------------------------------------------------------------------------
# Default sources
# ---------------------------------------------------------------------------

class TestResearchDefaultSources:
    @pytest.mark.asyncio
    async def test_defaults_to_web_search(self):
        """When sources=None, web_search is used."""
        tavily_mock = _make_tool_mock("web result content")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research("test query", sources=None, thread_id="t1")

        assert len(results) == 1
        assert results[0]["source"] == "web_search"
        assert results[0]["content"] == "web result content"
        tavily_mock.invoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_explicit_web_search(self):
        tavily_mock = _make_tool_mock("search results here")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research("what is Python?", sources=["web_search"])

        assert results[0]["source"] == "web_search"
        assert "search results here" in results[0]["content"]
        assert results[0]["url"] is None


# ---------------------------------------------------------------------------
# web_crawl source
# ---------------------------------------------------------------------------

class TestResearchWebCrawl:
    @pytest.mark.asyncio
    async def test_web_crawl_with_url_query(self):
        firecrawl_mock = _make_tool_mock("scraped page content")

        with (
            patch.object(researcher_module, "firecrawl_scrape", firecrawl_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research(
                "https://example.com/page",
                sources=["web_crawl"],
                thread_id="t1",
            )

        assert results[0]["source"] == "web_crawl"
        assert results[0]["content"] == "scraped page content"
        assert results[0]["url"] == "https://example.com/page"

    @pytest.mark.asyncio
    async def test_web_crawl_non_url_query_url_is_none(self):
        firecrawl_mock = _make_tool_mock("result")

        with (
            patch.object(researcher_module, "firecrawl_scrape", firecrawl_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research("not a url", sources=["web_crawl"])

        assert results[0]["url"] is None


# ---------------------------------------------------------------------------
# knowledge_base source
# ---------------------------------------------------------------------------

class TestResearchKnowledgeBase:
    @pytest.mark.asyncio
    async def test_knowledge_base_calls_rag(self):
        rag_mock = _make_tool_mock("rag knowledge results")

        with (
            patch.object(researcher_module, "docmost_rag", rag_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research(
                "API documentation",
                sources=["knowledge_base"],
                thread_id="t1",
                workspace_id="ws-abc",
            )

        assert results[0]["source"] == "knowledge_base"
        assert results[0]["content"] == "rag knowledge results"
        assert results[0]["url"] is None

    @pytest.mark.asyncio
    async def test_knowledge_base_passes_workspace_id(self):
        rag_mock = _make_tool_mock("rag result")

        with (
            patch.object(researcher_module, "docmost_rag", rag_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            await research("query", sources=["knowledge_base"], workspace_id="ws-999")

        call_kwargs = rag_mock.invoke.call_args[0][0]
        assert call_kwargs.get("workspace_id") == "ws-999"


# ---------------------------------------------------------------------------
# page_read source
# ---------------------------------------------------------------------------

class TestResearchPageRead:
    @pytest.mark.asyncio
    async def test_page_read_calls_page_read_tool(self):
        page_mock = _make_tool_mock("# Page Title\n\nPage content here.")

        with (
            patch.object(researcher_module, "docmost_page_read", page_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research(
                "page-id-123",
                sources=["page_read"],
                thread_id="t1",
            )

        assert results[0]["source"] == "page_read"
        assert "Page Title" in results[0]["content"]
        assert results[0]["url"] is None


# ---------------------------------------------------------------------------
# Multiple sources
# ---------------------------------------------------------------------------

class TestResearchMultipleSources:
    @pytest.mark.asyncio
    async def test_multiple_sources_all_queried(self):
        tavily_mock = _make_tool_mock("web result")
        rag_mock = _make_tool_mock("rag result")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch.object(researcher_module, "docmost_rag", rag_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research(
                "query",
                sources=["web_search", "knowledge_base"],
                thread_id="t1",
            )

        assert len(results) == 2
        sources = {r["source"] for r in results}
        assert sources == {"web_search", "knowledge_base"}

    @pytest.mark.asyncio
    async def test_unknown_source_skipped(self):
        tavily_mock = _make_tool_mock("web result")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research(
                "query",
                sources=["web_search", "invalid_source"],
                thread_id="t1",
            )

        # Only web_search result
        assert len(results) == 1
        assert results[0]["source"] == "web_search"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class TestResearchErrorHandling:
    @pytest.mark.asyncio
    async def test_tool_failure_returns_error_message(self):
        tavily_mock = MagicMock()
        tavily_mock.invoke.side_effect = RuntimeError("Network error")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research("query", sources=["web_search"])

        assert len(results) == 1
        assert "Research failed" in results[0]["content"]
        assert "web_search" in results[0]["source"]

    @pytest.mark.asyncio
    async def test_one_source_fails_others_succeed(self):
        tavily_mock = MagicMock()
        tavily_mock.invoke.side_effect = RuntimeError("Tavily down")
        rag_mock = _make_tool_mock("rag result")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch.object(researcher_module, "docmost_rag", rag_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research(
                "query",
                sources=["web_search", "knowledge_base"],
            )

        assert len(results) == 2
        kb_result = next(r for r in results if r["source"] == "knowledge_base")
        assert kb_result["content"] == "rag result"


# ---------------------------------------------------------------------------
# SSE events
# ---------------------------------------------------------------------------

class TestResearchSSEEvents:
    @pytest.mark.asyncio
    async def test_emits_step_start_and_done_per_source(self):
        tavily_mock = _make_tool_mock("result")
        rag_mock = _make_tool_mock("rag result")
        emit_calls: list[dict] = []

        async def fake_emit(thread_id: str, event: dict) -> None:
            emit_calls.append(event)

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch.object(researcher_module, "docmost_rag", rag_mock),
            patch("app.workers.researcher.emit", side_effect=fake_emit),
        ):
            await research(
                "query",
                sources=["web_search", "knowledge_base"],
                thread_id="t-emit",
            )

        # 2 sources × 2 events (start + done) = 4 events
        assert len(emit_calls) == 4
        event_types = [e["type"] for e in emit_calls]
        assert event_types.count("step_start") == 2
        assert event_types.count("step_done") == 2


# ---------------------------------------------------------------------------
# research_tool (orchestrator wrapper)
# ---------------------------------------------------------------------------

class TestResearchTool:
    @pytest.mark.asyncio
    async def test_research_tool_delegates_to_research(self):
        from app.orchestrator.tools.research import research_tool

        tavily_mock = _make_tool_mock("tool result")

        with (
            patch.object(researcher_module, "tavily_search", tavily_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research_tool("test query", sources=["web_search"])

        assert len(results) == 1
        assert results[0]["source"] == "web_search"

    @pytest.mark.asyncio
    async def test_research_tool_passes_workspace_id(self):
        from app.orchestrator.tools.research import research_tool

        rag_mock = _make_tool_mock("rag result")

        with (
            patch.object(researcher_module, "docmost_rag", rag_mock),
            patch("app.workers.researcher.emit", new_callable=AsyncMock),
        ):
            results = await research_tool(
                "query",
                sources=["knowledge_base"],
                workspace_id="ws-xyz",
            )

        assert results[0]["source"] == "knowledge_base"
