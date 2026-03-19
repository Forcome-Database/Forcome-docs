"""Tests for source image dedupe and upload materialization."""
from __future__ import annotations

from unittest.mock import patch

from app.models.asset_map import AssetItem


def test_compute_image_hash_is_stable():
    from app.tools.source_image_store import compute_image_hash

    first = compute_image_hash("YWJj")
    second = compute_image_hash("YWJj")

    assert first == second


def test_upgrade_source_image_assets_deduplicates_uploads():
    from app.tools.source_image_store import upgrade_source_image_assets

    with patch(
        "app.tools.source_image_store.upload_source_image",
        return_value="https://example.com/uploaded/source-image.png",
    ) as upload_mock:
        items = [
            AssetItem(
                id="img-1",
                type="image",
                source="spec.pdf",
                content="data:image/png;base64,YWJj",
                summary="[diagram] login flow",
            ),
            AssetItem(
                id="img-2",
                type="image",
                source="spec.pdf",
                content="data:image/png;base64,YWJj",
                summary="[diagram] login flow duplicate",
            ),
        ]

        upgraded = upgrade_source_image_assets(items, "page-1")

    assert upload_mock.call_count == 1
    assert upgraded[0].content == "https://example.com/uploaded/source-image.png"
    assert upgraded[1].content == "https://example.com/uploaded/source-image.png"
