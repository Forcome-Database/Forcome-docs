"""parse_assets orchestrator tool — wraps the AssetParser Worker.

Parses all uploaded files and merges results into a single AssetMap.
If a page_id is provided, also processes embedded images via VLM.

Files are parsed in parallel and results are cached by content hash.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Any

from cachetools import TTLCache

from app.models.asset_map import AssetMap
from app.tools.source_image_store import clear_source_image_cache, upgrade_source_image_assets
from app.utils.markdown_images import build_asset_image_placeholder
from app.workers.asset_parser import parse_document

# In-memory cache with TTL: content hash → AssetMap (max 20 entries, 1 hour TTL)
_asset_cache: TTLCache = TTLCache(maxsize=20, ttl=3600)
logger = logging.getLogger(__name__)
MARKDOWN_IMAGE_REF_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
HTML_IMAGE_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=["\'])([^"\']+)(["\'])', re.IGNORECASE)


def _file_hash(file_info: dict) -> str:
    """Hash file content for cache key."""
    content = file_info.get("content_b64", "")
    return hashlib.md5(content.encode()).hexdigest()


def _normalize_source_ref(ref: str) -> str:
    normalized = (ref or "").strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def _rewrite_source_markdown_image_refs(markdown: str, items: list) -> str:
    """Rewrite image refs in source_markdown using uploaded image URLs from items."""
    source_ref_to_url: dict[str, str] = {}
    for item in items:
        if item.type != "image" or not item.source_ref or not item.content:
            continue
        normalized_ref = _normalize_source_ref(item.source_ref)
        if normalized_ref:
            source_ref_to_url[normalized_ref] = item.content

    if not source_ref_to_url:
        return markdown

    def resolve_url(raw_ref: str) -> str | None:
        normalized = _normalize_source_ref(raw_ref)
        return source_ref_to_url.get(normalized) if normalized else None

    result = MARKDOWN_IMAGE_REF_RE.sub(
        lambda m: f"![{m.group(1)}]({r})" if (r := resolve_url(m.group(2))) else m.group(0),
        markdown,
    )
    result = HTML_IMAGE_SRC_RE.sub(
        lambda m: f"{m.group(1)}{r}{m.group(3)}" if (r := resolve_url(m.group(2))) else m.group(0),
        result,
    )
    return result


def _rewrite_text_asset_image_refs(items: list) -> list:
    source_ref_to_url: dict[str, str] = {}
    for item in items:
        if item.type != "image" or not item.source_ref or not item.content:
            continue
        normalized_ref = _normalize_source_ref(item.source_ref)
        if not normalized_ref:
            continue
        source_ref_to_url[normalized_ref] = item.content

    if not source_ref_to_url:
        return items

    rewritten_items = []

    def resolve_url(raw_ref: str) -> str | None:
        normalized_ref = _normalize_source_ref(raw_ref)
        if not normalized_ref:
            return None
        return source_ref_to_url.get(normalized_ref)

    for item in items:
        if item.type != "text" or not item.content:
            rewritten_items.append(item)
            continue

        content = item.content

        content = MARKDOWN_IMAGE_REF_RE.sub(
            lambda match: (
                f"![{match.group(1)}]({resolved})"
                if (resolved := resolve_url(match.group(2)))
                else match.group(0)
            ),
            content,
        )
        content = HTML_IMAGE_SRC_RE.sub(
            lambda match: (
                f"{match.group(1)}{resolved}{match.group(3)}"
                if (resolved := resolve_url(match.group(2)))
                else match.group(0)
            ),
            content,
        )

        rewritten_items.append(
            item if content == item.content else item.model_copy(update={"content": content})
        )

    return rewritten_items


def _placeholderize_text_asset_image_refs(items: list) -> list:
    image_url_to_placeholder: dict[str, str] = {}
    for item in items:
        if item.type != "image" or not item.content:
            continue
        image_url_to_placeholder[item.content] = build_asset_image_placeholder(item.id)

    if not image_url_to_placeholder:
        return items

    rewritten_items = []

    for item in items:
        if item.type != "text" or not item.content:
            rewritten_items.append(item)
            continue

        content = item.content

        content = MARKDOWN_IMAGE_REF_RE.sub(
            lambda match: (
                f"![{match.group(1)}]({placeholder})"
                if (placeholder := image_url_to_placeholder.get(match.group(2)))
                else match.group(0)
            ),
            content,
        )
        content = HTML_IMAGE_SRC_RE.sub(
            lambda match: (
                f"{match.group(1)}{placeholder}{match.group(3)}"
                if (placeholder := image_url_to_placeholder.get(match.group(2)))
                else match.group(0)
            ),
            content,
        )

        rewritten_items.append(
            item if content == item.content else item.model_copy(update={"content": content})
        )

    return rewritten_items


def _deduplicate_image_items(items: list) -> tuple[list, dict[str, str]]:
    """Deduplicate image AssetItems by content_hash."""
    seen_hashes: dict[str, str] = {}
    redirect_map: dict[str, str] = {}
    result = []
    for item in items:
        if item.type == "image" and getattr(item, "content_hash", None):
            if item.content_hash in seen_hashes:
                redirect_map[item.id] = seen_hashes[item.content_hash]
                continue
            seen_hashes[item.content_hash] = item.id
        result.append(item)
    return result, redirect_map


async def parse_assets_tool(
    files: list[dict[str, Any]],
    page_id: str | None = None,
) -> AssetMap:
    """Parse all uploaded files into a single AssetMap.

    Parses files in parallel and caches results by content hash.

    For each file dict the following keys are expected:
    - ``content_b64`` (str): Base-64 encoded file bytes.
    - ``filename``  (str): Original filename.
    - ``mimetype``  (str): MIME type.
    - ``images``    (list[dict], optional): Pre-extracted image dicts from
      docling output (each with "index", "b64", "desc" keys).  When this key
      is present **and** a ``page_id`` is supplied, images are also processed
      via VLM and uploaded to Docmost.

    Args:
        files: List of file info dicts (see above).
        page_id: Optional Docmost page ID used for uploading extracted images.

    Returns:
        A merged :class:`~app.models.asset_map.AssetMap` combining all files.
    """
    if not files:
        return AssetMap()

    async def parse_one(file_info: dict) -> AssetMap:
        cache_key = _file_hash(file_info)
        filename = file_info.get("filename", "unknown")
        if cache_key in _asset_cache:
            logger.info("asset_parse_cache_hit", extra={"source_filename": filename})
            return _asset_cache[cache_key]
        logger.info("asset_parse_cache_miss", extra={"source_filename": filename})

        # parse_document is sync, run in executor
        loop = asyncio.get_event_loop()
        asset_map = await loop.run_in_executor(
            None,
            parse_document,
            file_info.get("content_b64", ""),
            file_info.get("filename", "unknown"),
            file_info.get("mimetype", "application/octet-stream"),
        )

        _asset_cache[cache_key] = asset_map
        return asset_map

    # Parse all files in parallel
    results = await asyncio.gather(*[parse_one(f) for f in files])

    # Merge results
    combined = AssetMap()
    for asset_map in results:
        combined.items.extend(asset_map.items)
        combined.source_word_count += asset_map.source_word_count

        # Merge source_structure (append all heading lists)
        combined.source_structure.extend(asset_map.source_structure)

        # Merge section counts (accumulate word counts per heading)
        for key, count in asset_map.source_section_counts.items():
            combined.source_section_counts[key] = combined.source_section_counts.get(key, 0) + count

    # Deduplicate images across all documents
    combined.items, redirect_map = _deduplicate_image_items(combined.items)
    if redirect_map:
        for item in combined.items:
            if item.type == "text" and item.content:
                for old_id, new_id in redirect_map.items():
                    item.content = item.content.replace(old_id, new_id)

    if len(results) == 1:
        combined.document_title = results[0].document_title

    if page_id:
        combined.items = upgrade_source_image_assets(combined.items, page_id)
        combined.items = _rewrite_text_asset_image_refs(combined.items)

        # Also rewrite image refs in source_markdown so preservation_patch
        # can use it directly with correct Docmost image URLs
        if combined.source_markdown:
            combined.source_markdown = _rewrite_source_markdown_image_refs(
                combined.source_markdown, combined.items
            )

        combined.items = _placeholderize_text_asset_image_refs(combined.items)

    return combined


def clear_asset_cache() -> None:
    """Clear the asset cache (for testing)."""
    _asset_cache.clear()
    clear_source_image_cache()
