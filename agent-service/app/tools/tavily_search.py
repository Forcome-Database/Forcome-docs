from langchain_core.tools import tool
from tavily import TavilyClient

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def tavily_search(query: str, max_results: int = 5) -> str:
    """搜索网络获取最新信息。返回搜索结果的标题、摘要和链接。"""
    client = TavilyClient(api_key=settings.tavily_api_key)
    results = client.search(query=query, max_results=max_results)
    output_parts = []
    for r in results.get("results", []):
        output_parts.append(f"**{r['title']}**\n{r['content']}\nURL: {r['url']}\n")
    return "\n---\n".join(output_parts) if output_parts else "未找到相关结果。"
