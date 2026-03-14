"""Researcher Worker — wraps existing search and knowledge-base tools.

Provides a unified interface for research across multiple source types:
- web_search: Tavily web search
- web_crawl: Firecrawl page scraping
- knowledge_base: Docmost RAG (semantic search)
- page_read: Docmost page read (by page ID)
"""
from __future__ import annotations

from app.agent.events import emit  # imported at module level so tests can patch it


# ---------------------------------------------------------------------------
# Lazy tool references — imported at first use, replaceable in tests
# ---------------------------------------------------------------------------

def _get_tavily_search():
    from app.tools.tavily_search import tavily_search  # type: ignore
    return tavily_search


def _get_firecrawl_scrape():
    from app.tools.firecrawl_scrape import firecrawl_scrape  # type: ignore
    return firecrawl_scrape


def _get_docmost_rag():
    from app.tools.docmost_api import docmost_rag  # type: ignore
    return docmost_rag


def _get_docmost_page_read():
    from app.tools.docmost_api import docmost_page_read  # type: ignore
    return docmost_page_read


# Module-level aliases — patch these in tests.
tavily_search = None       # resolved lazily via _get_tavily_search()
firecrawl_scrape = None    # resolved lazily via _get_firecrawl_scrape()
docmost_rag = None         # resolved lazily via _get_docmost_rag()
docmost_page_read = None   # resolved lazily via _get_docmost_page_read()


def _tavily_invoke(query: str, max_results: int = 5) -> str:
    global tavily_search  # noqa: PLW0603
    tool = tavily_search if tavily_search is not None else _get_tavily_search()
    return tool.invoke({"query": query, "max_results": max_results})


def _firecrawl_invoke(url: str) -> str:
    global firecrawl_scrape  # noqa: PLW0603
    tool = firecrawl_scrape if firecrawl_scrape is not None else _get_firecrawl_scrape()
    return tool.invoke({"url": url})


def _rag_invoke(query: str, workspace_id: str = "") -> str:
    global docmost_rag  # noqa: PLW0603
    tool = docmost_rag if docmost_rag is not None else _get_docmost_rag()
    return tool.invoke({"query": query, "workspace_id": workspace_id})


def _page_read_invoke(page_id: str) -> str:
    global docmost_page_read  # noqa: PLW0603
    tool = docmost_page_read if docmost_page_read is not None else _get_docmost_page_read()
    return tool.invoke({"page_id": page_id})


# ---------------------------------------------------------------------------
# Supported source types
# ---------------------------------------------------------------------------

SUPPORTED_SOURCES = ("web_search", "web_crawl", "knowledge_base", "page_read")
DEFAULT_SOURCES = ["web_search"]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def research(
    query: str,
    sources: list[str] | None = None,
    thread_id: str = "",
    workspace_id: str = "",
) -> list[dict]:
    """Run research across specified source types and return results.

    Each result dict has the form:
    ``{"source": str, "content": str, "url": str | None}``

    Args:
        query: The research query string (also used as a page_id for
               "page_read" sources).
        sources: List of source types to query. Supported values:
                 "web_search", "web_crawl", "knowledge_base", "page_read".
                 Defaults to ["web_search"] if None.
        thread_id: SSE thread ID for event emission (optional).
        workspace_id: Docmost workspace ID, used for "knowledge_base" queries.

    Returns:
        List of result dicts, one per successful source query.
    """
    if sources is None:
        sources = DEFAULT_SOURCES

    results: list[dict] = []

    for source in sources:
        if source not in SUPPORTED_SOURCES:
            continue

        # Emit step_start per research action
        await emit(
            thread_id,
            {
                "type": "step_start",
                "step": f"research_{source}",
                "description": f"Researching via {source}: {query[:80]}…",
            },
        )

        content: str = ""
        url: str | None = None

        try:
            if source == "web_search":
                content = _tavily_invoke(query)
                url = None

            elif source == "web_crawl":
                # For web_crawl, query should be a URL
                content = _firecrawl_invoke(query)
                url = query if query.startswith(("http://", "https://")) else None

            elif source == "knowledge_base":
                content = _rag_invoke(query, workspace_id=workspace_id)
                url = None

            elif source == "page_read":
                # For page_read, query is treated as page_id
                content = _page_read_invoke(query)
                url = None

        except Exception as exc:
            content = f"Research failed for {source}: {exc}"

        result = {
            "source": source,
            "content": content,
            "url": url,
        }
        results.append(result)

        await emit(
            thread_id,
            {
                "type": "step_done",
                "step": f"research_{source}",
                "result_summary": (
                    f"{source}: {len(content)} chars retrieved"
                ),
            },
        )

    return results
