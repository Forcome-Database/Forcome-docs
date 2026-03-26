"""Firecrawl web scraping with content cleaning parameters."""
from firecrawl import FirecrawlApp
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool


@register_tool
@tool
def firecrawl_scrape(url: str) -> str:
    """Scrape a web page and return clean main-content Markdown."""
    if not url or not url.startswith(("http://", "https://")):
        return f"Invalid URL: {url[:100]}"

    client = FirecrawlApp(
        api_key=settings.firecrawl_api_key,
        api_url=settings.firecrawl_api_url,
    )

    result = client.scrape(
        url,
        formats=["markdown", "rawHtml"],
        only_main_content=True,
        exclude_tags=[
            "nav", "header", "footer", "aside",
            ".sidebar", ".navbar", ".navigation", ".menu",
            ".nav-bar", ".top-bar", ".header-wrapper",
            ".advertisement", ".ad", ".ads", ".banner",
            ".cookie-banner", ".cookie-consent", ".popup",
            ".modal", "#cookie-notice",
            ".social-share", ".share-buttons",
            "#comments", ".comments-section",
            ".breadcrumb", ".breadcrumbs",
        ],
        wait_for=1000,
        remove_base64_images=True,
        block_ads=True,
        timeout=30000,
    )

    fc_md = getattr(result, "markdown", None) or (
        result.get("markdown") if isinstance(result, dict) else None
    )
    raw_html = getattr(result, "rawHtml", None) or (
        result.get("rawHtml") if isinstance(result, dict) else None
    )

    # Trafilatura secondary cleaning if rawHtml is available
    if raw_html:
        from app.tools.trafilatura_extract import trafilatura_extract_sync

        traf_md = trafilatura_extract_sync(raw_html, url)
        if traf_md:
            return _select_best(fc_md, traf_md)

    return fc_md or "Failed to extract page content."


def _select_best(fc_md: str | None, traf_md: str) -> str:
    """Quality heuristic: pick the cleaner result."""
    if not fc_md:
        return traf_md
    fc_lines = fc_md.split("\n")
    short_lines = sum(1 for line in fc_lines if 0 < len(line.strip()) < 5)
    noise_ratio = short_lines / max(len(fc_lines), 1)
    if noise_ratio > 0.3:
        return traf_md
    if len(traf_md) < len(fc_md) * 0.3:
        return fc_md
    return traf_md
