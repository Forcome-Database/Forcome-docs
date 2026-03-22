from __future__ import annotations

import base64
import io
import json
import mimetypes
import re
import zipfile

from app.models.source_assets import DocumentParseResult, SourceImagePayload


def _find_member(zf: zipfile.ZipFile, suffixes: tuple[str, ...]) -> str | None:
    names = zf.namelist()
    for name in names:
        lowered = name.lower()
        if lowered.endswith(suffixes):
            return name
    return None


def _normalize_content_list(raw: object) -> list[dict]:
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        content_list = raw.get("content_list")
        if isinstance(content_list, list):
            return [item for item in content_list if isinstance(item, dict)]
    return []


def _read_json(zf: zipfile.ZipFile, name: str) -> object:
    return json.loads(zf.read(name).decode("utf-8"))


def _coerce_bbox(raw_bbox: object) -> list[float]:
    if not isinstance(raw_bbox, list):
        return []
    bbox: list[float] = []
    for value in raw_bbox[:4]:
        try:
            bbox.append(float(value))
        except (TypeError, ValueError):
            return []
    return bbox


def _image_member_name(zf: zipfile.ZipFile, img_path: str) -> str | None:
    normalized = img_path.replace("\\", "/").lstrip("./")
    for name in zf.namelist():
        candidate = name.replace("\\", "/")
        if candidate.endswith(normalized):
            return name
    return None


def _mime_type_for_name(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "image/png"


SECTION_HEADING_PATTERNS = (
    r"^\d+(?:\.\d+)*[.)]\s+",
    r"^\d+[、.．]\s*",
    r"^[IVXLCM]+[.)]\s+",
    r"^[A-Z][.)]\s+",
    r"^Chapter\s+\d+\b",
    r"^Section\s+\d+(?:\.\d+)*\b",
    r"^Part\s+\d+\b",
    r"^Step\s+\d+\b",
    r"^第[一二三四五六七八九十百千万\d]+[章节部分条步]\s*",
)


def _clean_title_candidate(raw: object) -> str:
    return str(raw or "").strip().strip("#").strip()


def _looks_like_section_heading(text: str) -> bool:
    candidate = _clean_title_candidate(text)
    if not candidate:
        return False
    return any(re.match(pattern, candidate, re.IGNORECASE) for pattern in SECTION_HEADING_PATTERNS)


def _extract_document_title(structure: list[dict], blocks: list[dict]) -> str:
    for heading in structure:
        text = _clean_title_candidate(heading.get("text") or heading.get("title"))
        if int(heading.get("level", 0) or 0) == 1 and text and not _looks_like_section_heading(text):
            return text

    for block in blocks:
        if block.get("type") != "heading":
            continue
        if block.get("page_number") not in (None, 1):
            continue

        text = _clean_title_candidate(block.get("text"))
        bbox = block.get("bbox") or []
        top = float(bbox[1]) if len(bbox) >= 2 else 0.0

        if not text or _looks_like_section_heading(text):
            continue
        if top > 140:
            continue

        return text

    return ""


def parse_mineru_zip(zip_bytes: bytes, filename: str) -> DocumentParseResult:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        markdown_name = _find_member(zf, ("full.md",))
        content_list_name = _find_member(zf, ("_content_list.json", "content_list.json"))

        text = ""
        if markdown_name:
            text = zf.read(markdown_name).decode("utf-8")

        content_list = _normalize_content_list(_read_json(zf, content_list_name)) if content_list_name else []

        structure: list[dict] = []
        blocks: list[dict] = []
        images: list[SourceImagePayload] = []

        for index, item in enumerate(content_list):
            item_type = str(item.get("type") or "").lower()
            page_idx = item.get("page_idx")
            try:
                page_number = int(page_idx) + 1 if page_idx is not None else None
            except (TypeError, ValueError):
                page_number = None

            if item_type == "text":
                text_value = str(item.get("text") or "").strip()
                text_level = item.get("text_level")
                is_heading = isinstance(text_level, int) and text_level > 0
                if is_heading:
                    structure.append({"level": int(text_level), "text": text_value})
                    blocks.append(
                        {
                            "type": "heading",
                            "text": text_value,
                            "level": int(text_level),
                            "page_number": page_number,
                            "bbox": _coerce_bbox(item.get("bbox")),
                        }
                    )
                elif text_value:
                    blocks.append(
                        {
                            "type": "text",
                            "text": text_value,
                            "page_number": page_number,
                            "bbox": _coerce_bbox(item.get("bbox")),
                        }
                    )
                continue

            if item_type != "image":
                continue

            img_path = str(item.get("img_path") or item.get("image_path") or "").strip()
            if not img_path:
                continue

            image_member = _image_member_name(zf, img_path)
            if image_member is None:
                continue

            image_bytes = zf.read(image_member)
            caption_parts = item.get("image_caption") or item.get("caption") or []
            footnote_parts = item.get("image_footnote") or item.get("footnote") or []
            if not isinstance(caption_parts, list):
                caption_parts = [caption_parts]
            if not isinstance(footnote_parts, list):
                footnote_parts = [footnote_parts]
            caption = " ".join(str(part).strip() for part in caption_parts if str(part).strip())
            footnote = " ".join(str(part).strip() for part in footnote_parts if str(part).strip())
            heading = structure[-1]["text"] if structure else ""
            desc = caption or footnote or f"Image {index + 1}"
            nearby_text = " ".join(part for part in [caption, footnote] if part).strip()

            images.append(
                SourceImagePayload(
                    index=len(images),
                    b64=base64.b64encode(image_bytes).decode("utf-8"),
                    desc=desc,
                    mime_type=_mime_type_for_name(image_member),
                    page_number=page_number,
                    heading=heading,
                    bbox=_coerce_bbox(item.get("bbox")),
                    nearby_text=nearby_text,
                    confidence=1.0,
                    parser="mineru",
                    source_ref=img_path,
                )
            )
            blocks.append(
                {
                    "type": "image",
                    "desc": desc,
                    "page_number": page_number,
                    "bbox": _coerce_bbox(item.get("bbox")),
                    "img_path": img_path,
                }
            )

        if not text:
            lines: list[str] = []
            for block in blocks:
                if block["type"] == "heading":
                    level = int(block.get("level") or 1)
                    lines.append(f"{'#' * level} {block['text']}")
                elif block["type"] == "text":
                    lines.append(block["text"])
                elif block["type"] == "image":
                    lines.append("<!-- image -->")
            text = "\n\n".join(line for line in lines if line)

        return DocumentParseResult(
            text=text,
            images=images,
            structure=structure,
            blocks=blocks,
            document_title=_extract_document_title(structure, blocks),
        )
