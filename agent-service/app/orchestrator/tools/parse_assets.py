"""parse_assets orchestrator tool — wraps the AssetParser Worker.

Parses all uploaded files and merges results into a single AssetMap.
If a page_id is provided, also processes embedded images via VLM.
"""
from __future__ import annotations

from app.models.asset_map import AssetMap
from app.workers.asset_parser import parse_document, process_images


async def parse_assets_tool(
    files: list[dict],
    page_id: str | None = None,
) -> AssetMap:
    """Parse all uploaded files and merge results into a single AssetMap.

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
    combined = AssetMap()

    for file_info in files:
        # --- Parse document structure ---
        asset_map = parse_document(
            file_content_b64=file_info["content_b64"],
            filename=file_info["filename"],
            mimetype=file_info["mimetype"],
        )

        combined.items.extend(asset_map.items)
        combined.source_word_count += asset_map.source_word_count

        # Merge source_structure (append all heading lists)
        combined.source_structure.extend(asset_map.source_structure)

        # Merge section counts (accumulate word counts per heading)
        for heading, wc in asset_map.source_section_counts.items():
            combined.source_section_counts[heading] = (
                combined.source_section_counts.get(heading, 0) + wc
            )

        # --- Process images if available and page_id is provided ---
        raw_images = file_info.get("images")
        if page_id and raw_images:
            image_assets = process_images(
                raw_images,
                file_info["filename"],
                page_id,
            )
            combined.items.extend(image_assets)

    return combined
