from __future__ import annotations

import logging
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
    async def test_parse_assets_raises_when_mineru_fails_for_supported_pdf(self, monkeypatch):
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
            with pytest.raises(RuntimeError, match="MinerU unavailable"):
                await parse_assets_tool(
                    files=[_make_file("source.pdf", "application/pdf", content_b64="cGRmMg==")]
                )

        mineru_mock.assert_called_once()
        docling_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_parse_assets_rejects_formats_outside_mineru_support(self, monkeypatch):
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
            with pytest.raises(ValueError, match="Unsupported attachment type"):
                await parse_assets_tool(
                    files=[
                        _make_file(
                            "sheet.xlsx",
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            content_b64="eGxzeA==",
                        )
                    ]
                )

        mineru_mock.assert_not_called()
        docling_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_parse_assets_logs_cache_miss_then_hit(self, monkeypatch, caplog):
        monkeypatch.setenv("MINERU_ENABLED", "true")
        caplog.set_level(logging.INFO)

        with patch(
            "app.workers.asset_parser._parse_with_mineru",
            return_value=_mineru_parse_result(),
        ) as mineru_mock:
            await parse_assets_tool(
                files=[_make_file("source.pdf", "application/pdf", content_b64="Y2FjaGU=")]
            )
            await parse_assets_tool(
                files=[_make_file("source.pdf", "application/pdf", content_b64="Y2FjaGU=")]
            )

        mineru_mock.assert_called_once()
        assert any(
            record.message == "asset_parse_cache_miss"
            and getattr(record, "source_filename", None) == "source.pdf"
            for record in caplog.records
        )
        assert any(
            record.message == "asset_parse_cache_hit"
            and getattr(record, "source_filename", None) == "source.pdf"
            for record in caplog.records
        )
