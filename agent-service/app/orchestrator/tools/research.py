"""research orchestrator tool — thin wrapper around the Researcher Worker.

Provides a consistent orchestrator-facing interface for multi-source research.
"""
from __future__ import annotations

from app.workers.researcher import research as _research


async def research_tool(
    query: str,
    sources: list[str] | None = None,
    thread_id: str = "",
    workspace_id: str = "",
) -> list[dict]:
    """Run research across specified source types.

    Delegates to the Researcher Worker which wraps tavily_search,
    firecrawl_scrape, docmost_rag, and docmost_page_read.

    Args:
        query: The research query string.
        sources: Source types to query: "web_search", "web_crawl",
                 "knowledge_base", "page_read". Defaults to ["web_search"].
        thread_id: SSE thread ID for event emission.
        workspace_id: Docmost workspace ID for knowledge_base queries.

    Returns:
        List of result dicts: [{"source": str, "content": str, "url": str|None}]
    """
    return await _research(
        query=query,
        sources=sources,
        thread_id=thread_id,
        workspace_id=workspace_id,
    )
