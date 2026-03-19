from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from app.models.asset_map import AssetItem
from app.tools.docmost_api import upload_page_image

_source_image_cache: dict[str, str] = {}


def clear_source_image_cache() -> None:
    _source_image_cache.clear()


def compute_image_hash(image_b64_or_data_uri: str) -> str:
    if image_b64_or_data_uri.startswith("data:"):
        _, image_b64_or_data_uri = image_b64_or_data_uri.split(",", 1)

    try:
        raw_bytes = base64.b64decode(image_b64_or_data_uri)
    except Exception:
        raw_bytes = image_b64_or_data_uri.encode("utf-8")

    return hashlib.md5(raw_bytes).hexdigest()


def _parse_data_uri(data_uri: str) -> tuple[str, str]:
    header, image_b64 = data_uri.split(",", 1)
    mime_type = header.removeprefix("data:").split(";", 1)[0] or "image/png"
    return mime_type, image_b64


def _extension_for_mime_type(mime_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mime_type, ".png")


def _build_upload_filename(asset: AssetItem, content_hash: str, mime_type: str) -> str:
    stem = Path(asset.source).stem or "source-image"
    return f"{stem}_{content_hash[:8]}{_extension_for_mime_type(mime_type)}"


def upload_source_image(
    page_id: str,
    file_content_b64: str,
    filename: str,
    mime_type: str,
) -> str:
    return upload_page_image(
        file_content_b64=file_content_b64,
        filename=filename,
        page_id=page_id,
        mime_type=mime_type,
    )


def upgrade_source_image_assets(items: list[AssetItem], page_id: str) -> list[AssetItem]:
    upgraded_items: list[AssetItem] = []

    for item in items:
        if item.type != "image" or not item.content.startswith("data:image/"):
            upgraded_items.append(item)
            continue

        mime_type, image_b64 = _parse_data_uri(item.content)
        content_hash = item.content_hash or compute_image_hash(image_b64)
        cache_key = f"{page_id}:{content_hash}"
        cached_url = _source_image_cache.get(cache_key)
        if cached_url is None:
            cached_url = upload_source_image(
                page_id=page_id,
                file_content_b64=image_b64,
                filename=_build_upload_filename(item, content_hash, mime_type),
                mime_type=mime_type,
            )
            _source_image_cache[cache_key] = cached_url

        upgraded_items.append(
            item.model_copy(
                update={
                    "content": cached_url,
                    "content_hash": content_hash,
                    "mime_type": mime_type,
                }
            )
        )

    return upgraded_items
