from langchain_core.tools import tool
from firecrawl import FirecrawlApp

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def firecrawl_scrape(url: str) -> str:
    """爬取指定 URL 的网页内容，返回结构化 Markdown。URL 必须以 http:// 或 https:// 开头。"""
    if not url or not url.startswith(("http://", "https://")):
        return f"无效 URL（必须以 http:// 或 https:// 开头）: {url[:100]}"
    client = FirecrawlApp(api_key=settings.firecrawl_api_key, api_url=settings.firecrawl_api_url)
    result = client.scrape(url, formats=["markdown"])
    md = result.get("markdown") if isinstance(result, dict) else getattr(result, "markdown", None)
    return md or "无法提取页面内容。"
