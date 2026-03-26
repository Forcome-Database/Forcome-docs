"""Trafilatura-based web content extraction for secondary cleaning."""
import asyncio
import logging

import trafilatura

logger = logging.getLogger(__name__)


def trafilatura_extract_sync(html: str, url: str | None = None) -> str | None:
    """Synchronous Trafilatura extraction. Call from sync context or via executor."""
    if not html or len(html) < 50:
        return None
    try:
        result = trafilatura.extract(
            html,
            output_format="markdown",
            favor_precision=True,
            include_images=True,
            include_tables=True,
            include_links=True,
            include_formatting=True,
            include_comments=False,
            url=url,
        )
        if result and len(result.strip()) > 50:
            return result
        return None
    except Exception as e:
        logger.warning("Trafilatura extraction failed for %s: %s", url, e)
        return None


async def trafilatura_extract_async(html: str, url: str | None = None) -> str | None:
    """Async wrapper - runs in thread pool to avoid blocking event loop."""
    return await asyncio.to_thread(trafilatura_extract_sync, html, url)
