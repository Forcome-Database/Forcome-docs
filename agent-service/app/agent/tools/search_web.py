"""工具：搜索互联网获取最新信息。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


async def search_web_impl(query: str) -> str:
    """可测试的核心逻辑。"""
    try:
        from app.tools.tavily_search import tavily_search

        # tavily_search 是 sync 函数（被 @tool 装饰），使用 .func 获取原始函数
        fn = tavily_search.func if hasattr(tavily_search, "func") else tavily_search
        result_text = await asyncio.wait_for(
            asyncio.to_thread(fn, query), timeout=15
        )
        if not result_text or len(str(result_text).strip()) < 20:
            return f"[No Results] No search results found for: {query}"
        return f"[Search Results for '{query}']\n\n{result_text}"
    except asyncio.TimeoutError:
        return "[Error] Web search timed out after 15 seconds."
    except Exception as e:
        return f"[Error] Search failed: {type(e).__name__}: {e}"


async def search_web_tool(ctx: RunContext["AgentDeps"], query: str) -> str:
    """Search the internet for current information on a topic.

    Call this when you need facts, references, or up-to-date information
    that is not available in the uploaded documents. Uses Tavily search engine
    (optimized for LLM use, much better quality than general search).

    Args:
        query: The search query (be specific for better results).
    """
    return await search_web_impl(query)
