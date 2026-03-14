"""Tests for parallel asset parsing and content-hash caching."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.orchestrator.tools.parse_assets import (
    clear_asset_cache,
    parse_assets_tool,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_file(
    filename: str = "doc.md",
    content_b64: str = "dGVzdA==",
    images: list | None = None,
) -> dict:
    d = {
        "content_b64": content_b64,
        "filename": filename,
        "mimetype": "text/markdown",
    }
    if images is not None:
        d["images"] = images
    return d


def _make_asset_map(source: str = "doc.md", word_count: int = 100) -> AssetMap:
    return AssetMap(
        items=[
            AssetItem(
                id=f"text-{source}",
                type="text",
                source=source,
                content="Sample content",
                summary=f"Section — {word_count} words",
            )
        ],
        source_structure=[{"level": 1, "text": "Title"}],
        source_word_count=word_count,
        source_section_counts={"Intro": word_count},
    )


def _make_image_assets(source: str, n: int = 1) -> list[AssetItem]:
    return [
        AssetItem(
            id=f"img-{source}-{i}",
            type="image",
            source=source,
            content=f"https://example.com/{source}/{i}.png",
            summary=f"[diagram] Image {i}",
        )
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestParseAssetsParallel:
    def setup_method(self):
        clear_asset_cache()

    @pytest.mark.asyncio
    async def test_parallel_parsing_calls_parse_document_for_each_file(self):
        """parse_document must be invoked once per file."""
        map_a = _make_asset_map("a.md", 50)
        map_b = _make_asset_map("b.md", 80)

        call_order: list[str] = []

        def fake_parse(content_b64: str, filename: str, mimetype: str) -> AssetMap:
            call_order.append(filename)
            return map_a if filename == "a.md" else map_b

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            side_effect=fake_parse,
        ):
            result = await parse_assets_tool(
                files=[
                    _make_file("a.md", content_b64="YQ=="),
                    _make_file("b.md", content_b64="Yg=="),
                ]
            )

        assert result.source_word_count == 130
        assert len(call_order) == 2
        assert set(call_order) == {"a.md", "b.md"}

    @pytest.mark.asyncio
    async def test_cache_hit_skips_parse_document(self):
        """Second call with the same file content must use the cache."""
        asset_map = _make_asset_map("doc.md", 100)
        parse_mock = MagicMock(return_value=asset_map)

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            parse_mock,
        ):
            # First call — cold
            await parse_assets_tool(files=[_make_file("doc.md", content_b64="dGVzdA==")])
            # Second call — same content → cache hit
            await parse_assets_tool(files=[_make_file("doc.md", content_b64="dGVzdA==")])

        # parse_document should have been called only once
        assert parse_mock.call_count == 1

    @pytest.mark.asyncio
    async def test_cache_miss_on_different_content(self):
        """Different content bytes → different cache keys → two parse calls."""
        asset_map = _make_asset_map("doc.md", 100)
        parse_mock = MagicMock(return_value=asset_map)

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            parse_mock,
        ):
            await parse_assets_tool(files=[_make_file("doc.md", content_b64="YQ==")])
            await parse_assets_tool(files=[_make_file("doc.md", content_b64="Yg==")])

        assert parse_mock.call_count == 2

    @pytest.mark.asyncio
    async def test_clear_cache_forces_reparse(self):
        """clear_asset_cache() invalidates the cache."""
        asset_map = _make_asset_map("doc.md", 100)
        parse_mock = MagicMock(return_value=asset_map)

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            parse_mock,
        ):
            await parse_assets_tool(files=[_make_file("doc.md", content_b64="dGVzdA==")])
            clear_asset_cache()
            await parse_assets_tool(files=[_make_file("doc.md", content_b64="dGVzdA==")])

        # Two parses: before and after cache clear
        assert parse_mock.call_count == 2

    @pytest.mark.asyncio
    async def test_images_processed_with_page_id(self):
        """Images are processed via process_images when page_id is provided."""
        asset_map = _make_asset_map("doc.pdf", 100)
        images = [{"index": 0, "b64": "abc", "desc": "diagram"}]
        image_assets = _make_image_assets("doc.pdf", n=2)

        with (
            patch(
                "app.orchestrator.tools.parse_assets.parse_document",
                return_value=asset_map,
            ),
            patch(
                "app.orchestrator.tools.parse_assets.process_images",
                return_value=image_assets,
            ) as mock_pi,
        ):
            result = await parse_assets_tool(
                files=[_make_file("doc.pdf", images=images)],
                page_id="page-xyz",
            )

        mock_pi.assert_called_once_with(images, "doc.pdf", "page-xyz")
        assert len(result.items_by_type("image")) == 2

    @pytest.mark.asyncio
    async def test_empty_files_returns_empty_asset_map(self):
        """Empty file list should return an empty AssetMap without errors."""
        result = await parse_assets_tool(files=[])
        assert isinstance(result, AssetMap)
        assert result.items == []
        assert result.source_word_count == 0
