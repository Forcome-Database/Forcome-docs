"""AssetParser Worker — document parsing and image processing.

Parses uploaded documents via docling_parser, extracts structured assets
(headings, text sections, tables, code blocks, mermaid diagrams), and
optionally processes embedded images via VLM understanding.
"""
from __future__ import annotations

import hashlib
import json
import re

from app.models.asset_map import AssetItem, AssetMap
from app.utils.text import count_words, count_words_by_section

# ---------------------------------------------------------------------------
# Lazy tool references — imported at first use, replaceable in tests
# ---------------------------------------------------------------------------
# We import them here so unittest.mock.patch("app.workers.asset_parser.<name>")
# can intercept them.  The actual heavyweight libraries are only loaded when the
# tools are first called.

def _get_docling_parser():
    from app.tools.docling_parser import docling_parser  # type: ignore
    return docling_parser


def _get_docmost_upload():
    from app.tools.docmost_api import docmost_upload  # type: ignore
    return docmost_upload


def _get_vlm_understand():
    from app.tools.vlm_understand import vlm_understand  # type: ignore
    return vlm_understand


# Module-level aliases — patch these in tests.
docling_parser = None   # resolved lazily via _get_docling_parser()
docmost_upload = None   # resolved lazily via _get_docmost_upload()
vlm_understand = None   # resolved lazily via _get_vlm_understand()


def _docling_parser_invoke(args: dict) -> str:
    """Call docling_parser, preferring the module-level alias if patched."""
    global docling_parser  # noqa: PLW0603
    tool = docling_parser if docling_parser is not None else _get_docling_parser()
    return tool.invoke(args)


def _docmost_upload_invoke(args: dict) -> str:
    """Call docmost_upload, preferring the module-level alias if patched."""
    global docmost_upload  # noqa: PLW0603
    tool = docmost_upload if docmost_upload is not None else _get_docmost_upload()
    return tool.invoke(args)


def _vlm_understand_invoke(args: dict) -> str:
    """Call vlm_understand, preferring the module-level alias if patched."""
    global vlm_understand  # noqa: PLW0603
    tool = vlm_understand if vlm_understand is not None else _get_vlm_understand()
    return tool.invoke(args)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _generate_asset_id(content: str, prefix: str = "asset") -> str:
    """Generate a stable short ID based on content hash."""
    digest = hashlib.md5(content.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}-{digest}"


def _extract_headings(text: str) -> list[dict]:
    """Extract all headings with their level and text.

    Returns a list of dicts: {"level": int, "text": str}.
    """
    headings = []
    for line in text.splitlines():
        m = re.match(r'^(#{1,6})\s+(.+)$', line)
        if m:
            headings.append({"level": len(m.group(1)), "text": m.group(2).strip()})
    return headings


def _split_sections(text: str) -> list[dict]:
    """Split text into sections by headings.

    Returns list of dicts: {"heading": str, "level": int, "content": str}.
    The first dict may have heading="" if there is content before the first heading.
    """
    sections: list[dict] = []
    current_heading = ""
    current_level = 0
    current_lines: list[str] = []

    for line in text.splitlines():
        m = re.match(r'^(#{1,6})\s+(.+)$', line)
        if m:
            # Save previous section
            content = "\n".join(current_lines).strip()
            if content or current_heading:
                sections.append({
                    "heading": current_heading,
                    "level": current_level,
                    "content": content,
                })
            current_heading = m.group(2).strip()
            current_level = len(m.group(1))
            current_lines = []
        else:
            current_lines.append(line)

    # Last section
    content = "\n".join(current_lines).strip()
    if content or current_heading:
        sections.append({
            "heading": current_heading,
            "level": current_level,
            "content": content,
        })

    return sections


def _extract_tables(text: str) -> list[str]:
    """Extract markdown tables from text.

    A table is a group of lines where every non-empty line starts with '|'.
    Returns list of raw table strings.
    """
    tables: list[str] = []
    in_table = False
    current_table: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            in_table = True
            current_table.append(line)
        else:
            if in_table and current_table:
                # Need at least header + separator rows (2 lines) to be a table
                if len(current_table) >= 2:
                    tables.append("\n".join(current_table))
                current_table = []
                in_table = False

    # Handle table at end of text
    if in_table and len(current_table) >= 2:
        tables.append("\n".join(current_table))

    return tables


def _extract_code_blocks(text: str) -> tuple[list[str], list[str]]:
    """Extract fenced code blocks and mermaid blocks separately.

    Returns (code_blocks, mermaid_blocks) — each is a list of raw block strings
    (including the fence markers).
    """
    code_blocks: list[str] = []
    mermaid_blocks: list[str] = []

    # Match fenced code blocks: ```[lang]\n...\n```
    pattern = re.compile(r'```(\w*)\n(.*?)```', re.DOTALL)
    for m in pattern.finditer(text):
        lang = m.group(1).lower()
        full_block = m.group(0)
        if lang == "mermaid":
            mermaid_blocks.append(full_block)
        else:
            code_blocks.append(full_block)

    return code_blocks, mermaid_blocks


# ---------------------------------------------------------------------------
# Public API — document parsing
# ---------------------------------------------------------------------------

def parse_document(
    file_content_b64: str,
    filename: str,
    mimetype: str,
) -> AssetMap:
    """Parse a document and return a structured AssetMap.

    Steps:
    1. Call docling_parser to obtain raw markdown text.
    2. Extract heading structure, text sections, tables, code blocks, mermaid.
    3. Compute source_word_count and source_section_counts.

    Args:
        file_content_b64: Base-64 encoded file bytes.
        filename: Original filename (used for extension detection).
        mimetype: MIME type of the file.

    Returns:
        Populated AssetMap.
    """
    raw_json = _docling_parser_invoke({
        "file_content_b64": file_content_b64,
        "filename": filename,
        "mimetype": mimetype,
    })
    result = json.loads(raw_json)
    text: str = result.get("text", "")

    items: list[AssetItem] = []

    # --- Heading structure ---
    headings = _extract_headings(text)
    if headings:
        heading_summary = "; ".join(
            f"{'#' * h['level']} {h['text']}" for h in headings
        )
        items.append(AssetItem(
            id=_generate_asset_id(heading_summary, "heading"),
            type="heading_structure",
            source=filename,
            content=json.dumps(headings, ensure_ascii=False),
            summary=f"{len(headings)} headings: {heading_summary[:120]}",
        ))

    # --- Remove code/mermaid blocks before text section extraction ---
    code_blocks, mermaid_blocks = _extract_code_blocks(text)
    text_without_code = re.sub(r'```(\w*)\n.*?```', '', text, flags=re.DOTALL)

    # --- Extract tables (from the original text, before code stripping) ---
    tables = _extract_tables(text)
    # Remove table lines from text so they don't inflate text sections
    text_without_code_tables = text_without_code
    for tbl in tables:
        text_without_code_tables = text_without_code_tables.replace(tbl, "")

    # --- Text sections ---
    sections = _split_sections(text_without_code_tables)
    for sec in sections:
        content = sec["content"].strip()
        if not content:
            continue
        wc = count_words(content)
        heading_label = sec["heading"] or "(intro)"
        items.append(AssetItem(
            id=_generate_asset_id(content[:64], "text"),
            type="text",
            source=filename,
            content=content,
            summary=f"Section '{heading_label}' — {wc} words",
        ))

    # --- Tables ---
    for i, tbl in enumerate(tables):
        items.append(AssetItem(
            id=_generate_asset_id(tbl[:64], "table"),
            type="table",
            source=filename,
            content=tbl,
            summary=f"Table {i + 1} ({tbl.count(chr(10)) + 1} rows)",
        ))

    # --- Code blocks ---
    for i, blk in enumerate(code_blocks):
        items.append(AssetItem(
            id=_generate_asset_id(blk[:64], "code"),
            type="code",
            source=filename,
            content=blk,
            summary=f"Code block {i + 1}",
        ))

    # --- Mermaid blocks ---
    for i, blk in enumerate(mermaid_blocks):
        items.append(AssetItem(
            id=_generate_asset_id(blk[:64], "mermaid"),
            type="mermaid",
            source=filename,
            content=blk,
            summary=f"Mermaid diagram {i + 1}",
        ))

    # --- Compute stats ---
    source_word_count = count_words(text)
    source_section_counts = count_words_by_section(text)

    # Build source_structure from headings
    source_structure = headings

    return AssetMap(
        items=items,
        source_structure=source_structure,
        source_word_count=source_word_count,
        source_section_counts=source_section_counts,
    )


# ---------------------------------------------------------------------------
# Image classification
# ---------------------------------------------------------------------------

def classify_image(vlm_description: str) -> str:
    """Classify an image based on a VLM description using keyword matching.

    Returns one of: screenshot, diagram, photo, chart, illustration, other.
    """
    desc_lower = vlm_description.lower()
    if "screenshot" in desc_lower or "screen capture" in desc_lower or "ui " in desc_lower:
        return "screenshot"
    if any(kw in desc_lower for kw in ("diagram", "architecture", "flowchart", "uml", "workflow")):
        return "diagram"
    # Use word-boundary for "graph" to avoid matching inside "photograph"
    if (
        "chart" in desc_lower
        or re.search(r'\bgraph\b', desc_lower)
        or "bar chart" in desc_lower
        or "pie chart" in desc_lower
        or "line graph" in desc_lower
    ):
        return "chart"
    if any(kw in desc_lower for kw in ("photo", "photograph", "camera", "real-world")):
        return "photo"
    if any(kw in desc_lower for kw in ("illustration", "drawing", "cartoon", "artwork", "sketch")):
        return "illustration"
    return "other"


# ---------------------------------------------------------------------------
# Image processing
# ---------------------------------------------------------------------------

def process_images(
    raw_images: list[dict],
    filename: str,
    page_id: str,
) -> list[AssetItem]:
    """Upload images to Docmost and obtain VLM descriptions.

    For each image dict (with keys "index", "b64", "desc"):
    1. Upload to Docmost → get URL.
    2. Call VLM → get description.
    3. Classify image type.
    4. Create an AssetItem.

    Args:
        raw_images: List of image dicts from docling_parser output.
        filename: Source document filename (used as source label).
        page_id: Docmost page ID for uploading the images.

    Returns:
        List of AssetItem with type="image".
    """
    asset_items: list[AssetItem] = []

    for img in raw_images:
        b64 = img.get("b64", "")
        docling_desc = img.get("desc", "")
        index = img.get("index", 0)

        if not b64:
            continue

        # Step 1: Upload image
        img_filename = f"img_{index}_{filename.replace(' ', '_')}.png"
        try:
            url = _docmost_upload_invoke({
                "file_content_b64": b64,
                "filename": img_filename,
                "page_id": page_id,
            })
        except Exception:
            # Skip images that fail to upload
            continue

        # Step 2: VLM description
        try:
            vlm_desc = _vlm_understand_invoke({
                "image_b64": b64,
                "question": "Describe the content of this image in detail.",
            })
        except Exception:
            # Fallback to docling description
            vlm_desc = docling_desc

        # Step 3: Classify
        image_type = classify_image(vlm_desc or docling_desc)

        asset_items.append(AssetItem(
            id=_generate_asset_id(b64[:32] + str(index), "img"),
            type="image",
            source=filename,
            content=url,
            summary=f"[{image_type}] {(vlm_desc or docling_desc)[:200]}",
        ))

    return asset_items
