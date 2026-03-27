"""工具：搜索互联网获取最新信息。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


def _get_tavily_fn():
    """返回可调用的 tavily_search 函数（工厂，方便测试 mock）。"""
    from app.tools.tavily_search import tavily_search
    return tavily_search.func if hasattr(tavily_search, "func") else tavily_search


async def search_web_impl(query: str) -> dict:
    """可测试的核心逻辑。"""
    try:
        fn = _get_tavily_fn()
        result_text = await asyncio.wait_for(
            asyncio.to_thread(fn, query), timeout=15
        )
        if not result_text or len(str(result_text).strip()) < 20:
            return {"status": "no_results", "query": query, "results": "", "message": "No results found."}
        return {"status": "success", "query": query, "results": str(result_text)}
    except asyncio.TimeoutError:
        return {"status": "error", "query": query, "error": "Web search timed out after 15 seconds."}
    except Exception as e:
        return {"status": "error", "query": query, "error": f"Search failed: {type(e).__name__}: {e}"}


async def search_web_tool(ctx: RunContext["AgentDeps"], query: str) -> dict:
    """Search the internet for current information on a topic.

    Call this when you need facts, references, or up-to-date information
    that is not available in the uploaded documents. Uses Tavily search engine
    (optimized for LLM use, much better quality than general search).

    Args:
        query: The search query (be specific for better results).
    """
    return await search_web_impl(query)
