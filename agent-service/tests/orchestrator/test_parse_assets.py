"""Tests for parse_assets orchestrator tool."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.orchestrator.tools.parse_assets import parse_assets_tool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_file(filename: str = "doc.md", images: list | None = None) -> dict:
    return {
        "content_b64": "dGVzdA==",  # b64("test")
        "filename": filename,
        "mimetype": "text/markdown",
        **({"images": images} if images is not None else {}),
    }


def _make_asset_map(
    source: str = "doc.md",
    word_count: int = 100,
    headings: list | None = None,
    document_title: str = "",
) -> AssetMap:
    items = [
        AssetItem(
            id=f"text-{source}",
            type="text",
            source=source,
            content="Sample content",
            summary=f"Section 'Intro' — {word_count} words",
        )
    ]
    headings_list = headings or [{"level": 1, "text": "Title"}]
    return AssetMap(
        items=items,
        source_structure=headings_list,
        source_word_count=word_count,
        source_section_counts={"Intro": word_count},
        document_title=document_title,
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

class TestParseAssetsTool:
    @pytest.mark.asyncio
    async def test_empty_files_returns_empty_asset_map(self):
        result = await parse_assets_tool(files=[])
        assert isinstance(result, AssetMap)
        assert result.items == []
        assert result.source_word_count == 0

    @pytest.mark.asyncio
    async def test_single_file_returns_asset_map(self):
        expected_map = _make_asset_map("a.md", word_count=50)

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            return_value=expected_map,
        ):
            result = await parse_assets_tool(files=[_make_file("a.md")])

        assert result.source_word_count == 50
        assert len(result.items) == 1

    @pytest.mark.asyncio
    async def test_multiple_files_word_counts_accumulated(self):
        map_a = _make_asset_map("a.md", word_count=100)
        map_b = _make_asset_map("b.md", word_count=200)

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            side_effect=[map_a, map_b],
        ):
            result = await parse_assets_tool(
                files=[_make_file("a.md"), _make_file("b.md")]
            )

        assert result.source_word_count == 300

    @pytest.mark.asyncio
    async def test_multiple_files_items_merged(self):
        map_a = _make_asset_map("a.md", word_count=10)
        map_b = _make_asset_map("b.md", word_count=20)

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            side_effect=[map_a, map_b],
        ):
            result = await parse_assets_tool(
                files=[_make_file("a.md"), _make_file("b.md")]
            )

        assert len(result.items) == 2

    @pytest.mark.asyncio
    async def test_source_structure_merged(self):
        map_a = _make_asset_map("a.md", headings=[{"level": 1, "text": "H1"}])
        map_b = _make_asset_map("b.md", headings=[{"level": 2, "text": "H2"}])

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            side_effect=[map_a, map_b],
        ):
            result = await parse_assets_tool(
                files=[_make_file("a.md"), _make_file("b.md")]
            )

        texts = [h["text"] for h in result.source_structure]
        assert "H1" in texts
        assert "H2" in texts

    @pytest.mark.asyncio
    async def test_single_source_document_title_is_preserved(self):
        expected_map = _make_asset_map("a.md", document_title="Source Title")

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            return_value=expected_map,
        ):
            result = await parse_assets_tool(files=[_make_file("a.md")])

        assert result.document_title == "Source Title"

    @pytest.mark.asyncio
    async def test_multiple_sources_do_not_pick_an_arbitrary_document_title(self):
        map_a = _make_asset_map("a.md", document_title="Title A")
        map_b = _make_asset_map("b.md", document_title="Title B")

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            side_effect=[map_a, map_b],
        ):
            result = await parse_assets_tool(
                files=[_make_file("a.md"), _make_file("b.md")]
            )

        assert result.document_title == ""

    @pytest.mark.asyncio
    async def test_section_counts_accumulated(self):
        map_a = AssetMap(
            items=[],
            source_word_count=50,
            source_section_counts={"Intro": 50},
        )
        map_b = AssetMap(
            items=[],
            source_word_count=80,
            source_section_counts={"Intro": 30, "Details": 50},
        )

        with patch(
            "app.orchestrator.tools.parse_assets.parse_document",
            side_effect=[map_a, map_b],
        ):
            result = await parse_assets_tool(
                files=[_make_file("a.md"), _make_file("b.md")]
            )

        # "Intro" from both files: 50 + 30
        assert result.source_section_counts["Intro"] == 80
        # "Details" only from b
        assert result.source_section_counts["Details"] == 50

    @pytest.mark.asyncio
    async def test_parser_extracted_images_materialized_without_file_images_key(self):
        asset_map = _make_asset_map("doc.pdf", word_count=100)
        asset_map.items.append(
            AssetItem(
                id="img-doc.pdf-0",
                type="image",
                source="doc.pdf",
                content="data:image/png;base64,YWJj",
                summary="[diagram] Login flow screenshot",
            )
        )
        upgraded_items = [
            asset_map.items[0],
            AssetItem(
                id="img-doc.pdf-0",
                type="image",
                source="doc.pdf",
                content="https://example.com/doc.pdf/0.png",
                summary="[diagram] Login flow screenshot",
            ),
        ]

        with (
            patch(
                "app.orchestrator.tools.parse_assets.parse_document",
                return_value=asset_map,
            ),
            patch(
                "app.orchestrator.tools.parse_assets.upgrade_source_image_assets",
                return_value=upgraded_items,
                create=True,
            ) as mock_upgrade,
        ):
            result = await parse_assets_tool(
                files=[_make_file("doc.pdf")],
                page_id="page-abc",
            )

        mock_upgrade.assert_called_once()
        image_items = result.items_by_type("image")
        assert len(image_items) == 1
        assert image_items[0].content == "https://example.com/doc.pdf/0.png"

    @pytest.mark.asyncio
    async def test_uploaded_source_text_rewrites_mineru_relative_image_paths_after_upload(self):
        asset_map = AssetMap(
            items=[
                AssetItem(
                    id="text-doc.pdf",
                    type="text",
                    source="doc.pdf",
                    content="段落一\n\n![采购退货流程](images/figure-1.png)\n\n段落二",
                    summary="Section with source image",
                ),
                AssetItem(
                    id="img-doc.pdf-0",
                    type="image",
                    source="doc.pdf",
                    content="data:image/png;base64,YWJj",
                    summary="[diagram] Login flow screenshot",
                    source_ref="images/figure-1.png",
                ),
            ],
            source_word_count=100,
        )
        upgraded_items = [
            asset_map.items[0],
            AssetItem(
                id="img-doc.pdf-0",
                type="image",
                source="doc.pdf",
                content="/api/files/file-1/采购退货流程.png",
                summary="[diagram] Login flow screenshot",
                source_ref="images/figure-1.png",
            ),
        ]

        with (
            patch(
                "app.orchestrator.tools.parse_assets.parse_document",
                return_value=asset_map,
            ),
            patch(
                "app.orchestrator.tools.parse_assets.upgrade_source_image_assets",
                return_value=upgraded_items,
                create=True,
            ),
        ):
            result = await parse_assets_tool(
                files=[_make_file("doc.pdf")],
                page_id="page-abc",
            )

        text_items = result.items_by_type("text")
        assert len(text_items) == 1
        assert "![采购退货流程](asset://img-doc.pdf-0)" in text_items[0].content
        assert "/api/files/file-1/采购退货流程.png" not in text_items[0].content
        assert "images/figure-1.png" not in text_items[0].content
