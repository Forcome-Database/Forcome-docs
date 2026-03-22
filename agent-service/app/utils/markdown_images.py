from __future__ import annotations

import re
from collections.abc import Mapping
from urllib.parse import quote


DOCMOST_INTERNAL_IMAGE_RE = re.compile(r"^/(?:api/)?files/", re.IGNORECASE)
SAFE_IMAGE_URI_RE = re.compile(r"^(?:https?|data):", re.IGNORECASE)
ASSET_IMAGE_URI_RE = re.compile(r"^asset://", re.IGNORECASE)
ASSET_IMAGE_MARKDOWN_RE = re.compile(r"!\[([^\]]*)\]\((asset://[^)]+)\)")
ASSET_IMAGE_HTML_RE = re.compile(r'(<img\b[^>]*?\bsrc=["\'])(asset://[^"\']+)(["\'])', re.IGNORECASE)


def is_supported_image_url(url: str) -> bool:
    normalized = (url or "").strip()
    if not normalized:
        return False

    return bool(
        SAFE_IMAGE_URI_RE.match(normalized)
        or DOCMOST_INTERNAL_IMAGE_RE.match(normalized)
    )


def normalize_markdown_image_url(url: str) -> str:
    normalized = (url or "").strip()
    if not normalized:
        return normalized

    # Docmost attachment routes are already canonical application paths.
    # Re-encoding them changes the persisted src away from the original asset URL.
    if DOCMOST_INTERNAL_IMAGE_RE.match(normalized):
        return normalized

    return quote(normalized, safe="/:?&=%#@+,;~-._")


def build_asset_image_placeholder(asset_id: str) -> str:
    return f"asset://{asset_id}"


def resolve_asset_image_placeholders(
    content: str,
    image_urls: Mapping[str, str],
) -> str:
    if not content or not image_urls:
        return content

    def resolve_asset_uri(uri: str) -> str | None:
        if not ASSET_IMAGE_URI_RE.match(uri):
            return None
        asset_id = uri.removeprefix("asset://").strip()
        return image_urls.get(asset_id)

    content = ASSET_IMAGE_MARKDOWN_RE.sub(
        lambda match: (
            f"![{match.group(1)}]({normalize_markdown_image_url(resolved_url)})"
            if (resolved_url := resolve_asset_uri(match.group(2)))
            else match.group(0)
        ),
        content,
    )
    content = ASSET_IMAGE_HTML_RE.sub(
        lambda match: (
            f'{match.group(1)}{normalize_markdown_image_url(resolved_url)}{match.group(3)}'
            if (resolved_url := resolve_asset_uri(match.group(2)))
            else match.group(0)
        ),
        content,
    )
    return content
