"""工具：抓取网页主要内容。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


def _get_firecrawl_fn():
    """返回可调用的 firecrawl_scrape 函数（工厂，方便测试 mock）。"""
    from app.tools.firecrawl_scrape import firecrawl_scrape
    return firecrawl_scrape.func if hasattr(firecrawl_scrape, "func") else firecrawl_scrape


async def scrape_url_impl(url: str) -> dict:
    """可测试的核心逻辑。"""
    if not url.startswith(("http://", "https://")):
        return {"status": "error", "url": url, "error": f"Invalid URL format: {url}. Must start with http:// or https://."}

    try:
        fn = _get_firecrawl_fn()
        content = await asyncio.wait_for(
            asyncio.to_thread(fn, url), timeout=30
        )
        if not content or len(str(content).strip()) < 50:
            return {"status": "error", "url": url, "error": f"No meaningful content extracted from {url}."}
        content_str = str(content)
        truncated = len(content_str) > 8000
        if truncated:
            content_str = content_str[:8000]
        return {
            "status": "success",
            "url": url,
            "content": content_str,
            "word_count": len(content_str.split()),
            "truncated": truncated,
        }
    except asyncio.TimeoutError:
        return {"status": "error", "url": url, "error": f"Scraping {url} timed out after 30 seconds."}
    except Exception as e:
        return {"status": "error", "url": url, "error": f"Failed to scrape {url}: {type(e).__name__}: {e}"}


async def scrape_url_tool(ctx: RunContext["AgentDeps"], url: str) -> dict:
    """Fetch and extract the main content from a web URL.

    Call this when the user provides a URL or you need to read a web page.
    Returns cleaned main content with navigation/ads/footers removed.
    Uses Firecrawl + Trafilatura dual-engine for high quality extraction.

    Args:
        url: The full URL to scrape (must start with http:// or https://).
    """
    return await scrape_url_impl(url)
