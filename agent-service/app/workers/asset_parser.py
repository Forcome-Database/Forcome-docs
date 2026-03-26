"""Asset parser worker for source documents and images."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
from pathlib import Path

import pybreaker

from app.models.asset_map import AssetItem, AssetMap
from app.models.source_assets import DocumentParseResult, SourceImagePayload
from app.tools.mineru_client import MinerUClient, MinerUConfig
from app.utils.text import count_words, count_words_by_section
from app.workers.mineru_parser import parse_mineru_zip

MINERU_SUPPORTED_EXTENSIONS = {
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "png",
    "jpg",
    "jpeg",
    "html",
}

MINERU_SUPPORTED_MIMETYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/html",
    "image/png",
    "image/jpeg",
    "image/jpg",
}


def _get_docmost_upload():
    from app.tools.docmost_api import docmost_upload  # type: ignore
    return docmost_upload


def _get_vlm_understand():
    from app.tools.vlm_understand import vlm_understand  # type: ignore
    return vlm_understand


docmost_upload = None
vlm_understand = None
logger = logging.getLogger(__name__)


def _docmost_upload_invoke(args: dict) -> str:
    global docmost_upload  # noqa: PLW0603
    tool = docmost_upload if docmost_upload is not None else _get_docmost_upload()
    return tool.invoke(args)


def _vlm_understand_invoke(args: dict) -> str:
    global vlm_understand  # noqa: PLW0603
    tool = vlm_understand if vlm_understand is not None else _get_vlm_understand()
    return tool.invoke(args)


_mineru_breaker = pybreaker.CircuitBreaker(
    fail_max=3,
    reset_timeout=300,
    name="mineru",
)


def _generate_asset_id(content: str, prefix: str = "asset") -> str:
    digest = hashlib.md5(content.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}-{digest}"


def _build_source_image_asset(image: SourceImagePayload, filename: str) -> AssetItem | None:
    if not image.b64:
        return None

    try:
        raw_bytes = base64.b64decode(image.b64)
    except Exception:
        raw_bytes = image.b64.encode("utf-8")

    content_hash = hashlib.md5(raw_bytes).hexdigest()
    description = image.desc or f"Image {image.index + 1}"

    return AssetItem(
        id=_generate_asset_id(f"{filename}:{content_hash}:{image.index}", "img"),
        type="image",
        source=filename,
        content=image.to_data_uri(),
        summary=f"[source_image] {description[:200]}",
        origin="uploaded_source",
        content_hash=content_hash,
        caption=description,
        source_page=image.resolved_page_number,
        source_heading=image.heading,
        mime_type=image.mime_type,
        source_ref=image.source_ref,
    )


def _supports_mineru(filename: str, mimetype: str) -> bool:
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if extension in MINERU_SUPPORTED_EXTENSIONS:
        return True

    normalized_mime = (mimetype or "").lower()
    return normalized_mime in MINERU_SUPPORTED_MIMETYPES


def _extract_headings(text: str) -> list[dict]:
    headings = []
    for line in text.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if match:
            headings.append({"level": len(match.group(1)), "text": match.group(2).strip()})
    return headings


def _split_sections(text: str) -> list[dict]:
    sections: list[dict] = []
    current_heading = ""
    current_level = 0
    current_lines: list[str] = []

    for line in text.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if match:
            content = "\n".join(current_lines).strip()
            if content or current_heading:
                sections.append(
                    {
                        "heading": current_heading,
                        "level": current_level,
                        "content": content,
                    }
                )
            current_heading = match.group(2).strip()
            current_level = len(match.group(1))
            current_lines = []
        else:
            current_lines.append(line)

    content = "\n".join(current_lines).strip()
    if content or current_heading:
        sections.append(
            {
                "heading": current_heading,
                "level": current_level,
                "content": content,
            }
        )

    return sections


def _extract_tables(text: str) -> list[str]:
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
                if len(current_table) >= 2:
                    tables.append("\n".join(current_table))
                current_table = []
                in_table = False

    if in_table and len(current_table) >= 2:
        tables.append("\n".join(current_table))

    return tables


def _extract_code_blocks(text: str) -> tuple[list[str], list[str]]:
    code_blocks: list[str] = []
    mermaid_blocks: list[str] = []

    pattern = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
    for match in pattern.finditer(text):
        lang = match.group(1).lower()
        full_block = match.group(0)
        if lang == "mermaid":
            mermaid_blocks.append(full_block)
        else:
            code_blocks.append(full_block)

    return code_blocks, mermaid_blocks


def _fallback_document_title(filename: str) -> str:
    return Path(filename).stem.strip()


def _parse_with_mineru(file_content_b64: str, filename: str, mimetype: str) -> DocumentParseResult:
    config = MinerUConfig.from_env()
    if not config.enabled:
        raise RuntimeError("MinerU is not enabled")

    file_bytes = base64.b64decode(file_content_b64)

    async def _run() -> bytes:
        client = MinerUClient(config=config)
        try:
            result = await client.extract_file(
                name=filename,
                content=file_bytes,
                is_ocr=mimetype.lower().startswith("image/"),
            )
            return result.zip_bytes
        finally:
            await client.aclose()

    zip_bytes = asyncio.run(_run())
    return parse_mineru_zip(zip_bytes, filename)


def _asset_map_from_parsed_document(parsed: DocumentParseResult, filename: str) -> AssetMap:
    text = parsed.text
    items: list[AssetItem] = []

    headings = parsed.structure or _extract_headings(text)
    if headings:
        heading_summary = "; ".join(f"{'#' * h['level']} {h['text']}" for h in headings)
        items.append(
            AssetItem(
                id=_generate_asset_id(heading_summary, "heading"),
                type="heading_structure",
                source=filename,
                content=json.dumps(headings, ensure_ascii=False),
                summary=f"{len(headings)} headings: {heading_summary[:120]}",
            )
        )

    code_blocks, mermaid_blocks = _extract_code_blocks(text)
    text_without_code = re.sub(r"```(\w*)\n.*?```", "", text, flags=re.DOTALL)

    tables = _extract_tables(text)
    text_without_code_tables = text_without_code
    for table in tables:
        text_without_code_tables = text_without_code_tables.replace(table, "")

    sections = _split_sections(text_without_code_tables)
    for section in sections:
        content = section["content"].strip()
        if not content:
            continue
        wc = count_words(content)
        heading_label = section["heading"] or "(intro)"
        items.append(
            AssetItem(
                id=_generate_asset_id(content[:64], "text"),
                type="text",
                source=filename,
                content=content,
                summary=f"Section '{heading_label}' - {wc} words",
            )
        )

    for index, table in enumerate(tables):
        items.append(
            AssetItem(
                id=_generate_asset_id(table[:64], "table"),
                type="table",
                source=filename,
                content=table,
                summary=f"Table {index + 1} ({table.count(chr(10)) + 1} rows)",
            )
        )

    for index, block in enumerate(code_blocks):
        items.append(
            AssetItem(
                id=_generate_asset_id(block[:64], "code"),
                type="code",
                source=filename,
                content=block,
                summary=f"Code block {index + 1}",
            )
        )

    for index, block in enumerate(mermaid_blocks):
        items.append(
            AssetItem(
                id=_generate_asset_id(block[:64], "mermaid"),
                type="mermaid",
                source=filename,
                content=block,
                summary=f"Mermaid diagram {index + 1}",
            )
        )

    for image_payload in parsed.images:
        image_item = _build_source_image_asset(image_payload, filename)
        if image_item is not None:
            items.append(image_item)

    return AssetMap(
        items=items,
        source_structure=headings,
        source_word_count=count_words(text),
        source_section_counts=count_words_by_section(text),
        source_markdown=text,
        document_title=(parsed.document_title or "").strip() or _fallback_document_title(filename),
    )


def parse_document(file_content_b64: str, filename: str, mimetype: str) -> AssetMap:
    """Parse a document into the shared AssetMap contract.

    Use MinerU for all supported attachment formats.
    Unsupported formats are rejected, and MinerU failures surface directly.
    """
    if not _supports_mineru(filename, mimetype):
        raise ValueError(
            f"Unsupported attachment type for MinerU: {filename} ({mimetype or 'unknown'})"
        )

    logger.info(
        "mineru_parse_start",
        extra={"source_filename": filename, "source_mimetype": mimetype or "unknown"},
    )
    try:
        parsed = _mineru_breaker.call(
            _parse_with_mineru, file_content_b64, filename, mimetype
        )
    except pybreaker.CircuitBreakerError:
        raise ValueError(
            "Document parsing service temporarily unavailable. Please try again later."
        )
    logger.info(
        "mineru_parse_complete",
        extra={
            "source_filename": filename,
            "source_mimetype": mimetype or "unknown",
            "image_count": len(parsed.images),
            "source_word_count": count_words(parsed.text),
        },
    )

    return _asset_map_from_parsed_document(parsed, filename)


def classify_image(vlm_description: str) -> str:
    desc_lower = vlm_description.lower()
    if "screenshot" in desc_lower or "screen capture" in desc_lower or "ui " in desc_lower:
        return "screenshot"
    if any(kw in desc_lower for kw in ("diagram", "architecture", "flowchart", "uml", "workflow")):
        return "diagram"
    if (
        "chart" in desc_lower
        or re.search(r"\bgraph\b", desc_lower)
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


def process_images(
    raw_images: list[dict],
    filename: str,
    page_id: str,
) -> list[AssetItem]:
    asset_items: list[AssetItem] = []

    for img in raw_images:
        b64 = img.get("b64", "")
        docling_desc = img.get("desc", "")
        index = img.get("index", 0)

        if not b64:
            continue

        img_filename = f"img_{index}_{filename.replace(' ', '_')}.png"
        try:
            url = _docmost_upload_invoke(
                {
                    "file_content_b64": b64,
                    "filename": img_filename,
                    "page_id": page_id,
                }
            )
        except Exception:
            continue

        try:
            vlm_desc = _vlm_understand_invoke(
                {
                    "image_b64": b64,
                    "question": "Describe the content of this image in detail.",
                }
            )
        except Exception:
            vlm_desc = docling_desc

        image_type = classify_image(vlm_desc or docling_desc)
        asset_items.append(
            AssetItem(
                id=_generate_asset_id(b64[:32] + str(index), "img"),
                type="image",
                source=filename,
                content=url,
                summary=f"[{image_type}] {(vlm_desc or docling_desc)[:200]}",
            )
        )

    return asset_items
