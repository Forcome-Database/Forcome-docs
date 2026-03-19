from __future__ import annotations

from unittest.mock import patch

import pytest

from app.models.asset_map import AssetItem
from app.models.source_assets import DocumentParseResult, SourceImagePayload
from app.orchestrator.tools.parse_assets import clear_asset_cache, parse_assets_tool


def _make_file(
    filename: str,
    mimetype: str,
    content_b64: str = "dGVzdA==",
) -> dict:
    return {
        "content_b64": content_b64,
        "filename": filename,
        "mimetype": mimetype,
    }


def _docling_parse_result() -> DocumentParseResult:
    return DocumentParseResult(
        text="# Docling Title\n\nDocling fallback content.",
        structure=[{"level": 1, "text": "Docling Title"}],
    )


def _mineru_parse_result() -> DocumentParseResult:
    return DocumentParseResult(
        text="# MinerU Title\n\nMinerU preserved content.",
        structure=[{"level": 1, "text": "MinerU Title"}],
        images=[
            SourceImagePayload(
                index=0,
                b64="YWJj",
                desc="Source screenshot",
                page_number=1,
                parser="mineru",
            )
        ],
    )


class TestParseAssetsMineruRouting:
    def setup_method(self):
        clear_asset_cache()

    @pytest.mark.asyncio
    async def test_parse_assets_uses_mineru_first_for_pdf(self, monkeypatch):
        monkeypatch.setenv("MINERU_ENABLED", "true")

        with (
            patch(
                "app.workers.asset_parser._parse_with_mineru",
                return_value=_mineru_parse_result(),
            ) as mineru_mock,
            patch(
                "app.workers.asset_parser._parse_with_docling",
                return_value=_docling_parse_result(),
            ) as docling_mock,
        ):
            result = await parse_assets_tool(
                files=[_make_file("source.pdf", "application/pdf", content_b64="cGRmMQ==")]
            )

        mineru_mock.assert_called_once()
        docling_mock.assert_not_called()
        assert result.source_structure[0]["text"] == "MinerU Title"
        assert len(result.items_by_type("image")) == 1

    @pytest.mark.asyncio
    async def test_parse_assets_falls_back_to_docling_when_mineru_fails(self, monkeypatch):
        monkeypatch.setenv("MINERU_ENABLED", "true")

        with (
            patch(
                "app.workers.asset_parser._parse_with_mineru",
                side_effect=RuntimeError("MinerU unavailable"),
            ) as mineru_mock,
            patch(
                "app.workers.asset_parser._parse_with_docling",
                return_value=_docling_parse_result(),
            ) as docling_mock,
        ):
            result = await parse_assets_tool(
                files=[_make_file("source.pdf", "application/pdf", content_b64="cGRmMg==")]
            )

        mineru_mock.assert_called_once()
        docling_mock.assert_called_once()
        assert result.source_structure[0]["text"] == "Docling Title"
        assert result.items_by_type("image") == []

    @pytest.mark.asyncio
    async def test_parse_assets_keeps_docling_for_xlsx_even_when_mineru_enabled(self, monkeypatch):
        monkeypatch.setenv("MINERU_ENABLED", "true")

        with (
            patch(
                "app.workers.asset_parser._parse_with_mineru",
                return_value=_mineru_parse_result(),
            ) as mineru_mock,
            patch(
                "app.workers.asset_parser._parse_with_docling",
                return_value=_docling_parse_result(),
            ) as docling_mock,
        ):
            result = await parse_assets_tool(
                files=[
                    _make_file(
                        "sheet.xlsx",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        content_b64="eGxzeA==",
                    )
                ]
            )

        mineru_mock.assert_not_called()
        docling_mock.assert_called_once()
        heading_items = result.items_by_type("heading_structure")
        assert heading_items[0].summary.startswith("1 headings")
