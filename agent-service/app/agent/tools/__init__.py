"""Agent 工具包 — 可扩展的工具集合。"""
from app.agent.tools.extract_document import extract_document_tool
from app.agent.tools.describe_images import describe_images_tool
from app.agent.tools.scrape_url import scrape_url_tool
from app.agent.tools.search_web import search_web_tool
from app.agent.tools.read_page import read_page_tool

ALL_TOOLS = [
    extract_document_tool,
    describe_images_tool,
    scrape_url_tool,
    search_web_tool,
    read_page_tool,
]

__all__ = [
    "ALL_TOOLS",
    "extract_document_tool",
    "describe_images_tool",
    "scrape_url_tool",
    "search_web_tool",
    "read_page_tool",
]
