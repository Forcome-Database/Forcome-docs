"""工具：抓取网页主要内容。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


async def scrape_url_impl(url: str) -> str:
    """可测试的核心逻辑。"""
    if not url.startswith(("http://", "https://")):
        return f"[Error] Invalid URL format: {url}. Must start with http:// or https://."

    try:
        from app.tools.firecrawl_scrape import firecrawl_scrape

        # firecrawl_scrape 是 sync 函数（被 @tool 装饰），使用 .func 获取原始函数
        fn = firecrawl_scrape.func if hasattr(firecrawl_scrape, "func") else firecrawl_scrape
        content = await asyncio.wait_for(
            asyncio.to_thread(fn, url), timeout=30
        )
        if not content or len(str(content).strip()) < 50:
            return f"[Error] No meaningful content extracted from {url}."
        content_str = str(content)
        if len(content_str) > 8000:
            content_str = content_str[:8000] + f"\n\n[Truncated — original {len(content_str)} characters]"
        return f"[Web Content from {url}]\n{content_str}"
    except asyncio.TimeoutError:
        return f"[Error] Scraping {url} timed out after 30 seconds."
    except Exception as e:
        return f"[Error] Failed to scrape {url}: {type(e).__name__}: {e}"


async def scrape_url_tool(ctx: RunContext["AgentDeps"], url: str) -> str:
    """Fetch and extract the main content from a web URL.

    Call this when the user provides a URL or you need to read a web page.
    Returns cleaned main content with navigation/ads/footers removed.
    Uses Firecrawl + Trafilatura dual-engine for high quality extraction.

    Args:
        url: The full URL to scrape (must start with http:// or https://).
    """
    return await scrape_url_impl(url)
