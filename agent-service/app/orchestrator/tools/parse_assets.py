"""parse_assets orchestrator tool — wraps the AssetParser Worker.

Parses all uploaded files and merges results into a single AssetMap.
If a page_id is provided, also processes embedded images via VLM.

Files are parsed in parallel and results are cached by content hash.
"""
from __future__ import annotations

import asyncio
import hashlib
from typing import Any

from app.models.asset_map import AssetMap
from app.tools.source_image_store import clear_source_image_cache, upgrade_source_image_assets
from app.workers.asset_parser import parse_document

# Simple in-memory cache: content hash → AssetMap
_asset_cache: dict[str, AssetMap] = {}


def _file_hash(file_info: dict) -> str:
    """Hash file content for cache key."""
    content = file_info.get("content_b64", "")
    return hashlib.md5(content.encode()).hexdigest()


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
        if cache_key in _asset_cache:
            return _asset_cache[cache_key]

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

    if page_id:
        combined.items = upgrade_source_image_assets(combined.items, page_id)

    return combined


def clear_asset_cache() -> None:
    """Clear the asset cache (for testing)."""
    _asset_cache.clear()
    clear_source_image_cache()
