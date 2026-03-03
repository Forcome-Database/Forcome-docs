from langchain_core.tools import tool
from firecrawl import FirecrawlApp

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def firecrawl_scrape(url: str) -> str:
    """爬取指定 URL 的网页内容，返回结构化 Markdown。"""
    client = FirecrawlApp(api_key=settings.firecrawl_api_key, api_url=settings.firecrawl_api_url)
    result = client.scrape_url(url, params={"formats": ["markdown"]})
    return result.get("markdown", "无法提取页面内容。")
