"""Tests for generate_section_visuals() in SectionWriter Worker."""
from __future__ import annotations

import asyncio
import logging
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import SectionPlan, VisualPlan


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_section(
    sid: str = "s1",
    visuals: list[VisualPlan] | None = None,
    assets: list[str] | None = None,
) -> SectionPlan:
    return SectionPlan(
        id=sid,
        title="Test Section",
        visuals=visuals or [],
        assets=assets or [],
        word_budget=300,
    )


def _make_asset_map(items: list[AssetItem] | None = None) -> AssetMap:
    return AssetMap(items=items or [])


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestGenerateSectionVisuals:
    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_visuals(self):
        from app.workers.section_writer import generate_section_visuals
        section = _make_section(visuals=[])
        result = await generate_section_visuals(section, None, "", None)
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_mermaid_visual(self):
        """Mermaid visuals are inline — no URL generation."""
        from app.workers.section_writer import generate_section_visuals
        visual = VisualPlan(type="mermaid", description="flow diagram")
        section = _make_section(visuals=[visual])
        result = await generate_section_visuals(section, None, "", None)
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_reuse_image_visual(self):
        """Reuse image visuals use existing URLs — no generation needed."""
        from app.workers.section_writer import generate_section_visuals
        visual = VisualPlan(type="reuse_image", description="existing image", source_asset_id="img-1")
        section = _make_section(visuals=[visual])
        result = await generate_section_visuals(section, None, "", None)
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_table_visual(self):
        """Table visuals are inline — no URL generation."""
        from app.workers.section_writer import generate_section_visuals
        visual = VisualPlan(type="table", description="comparison table")
        section = _make_section(visuals=[visual])
        result = await generate_section_visuals(section, None, "", None)
        assert result == []

    @pytest.mark.asyncio
    async def test_generates_and_uploads_ai_image_with_page_id(self):
        """When ai_image visual is present and page_id provided, generate and upload."""
        from app.workers.section_writer import generate_section_visuals

        visual = VisualPlan(type="ai_image", description="futuristic city skyline")
        section = _make_section(visuals=[visual])

        fake_b64 = "iVBORw0KGgoAAAANSUhEUg=="
        fake_url = "https://cdn.docmost.com/uploads/generated.png"

        with patch("app.tools.nanobana_imggen.nanobana_imggen") as mock_imggen, \
             patch("app.tools.docmost_api.docmost_upload") as mock_upload:
            mock_imggen.invoke = MagicMock(return_value=fake_b64)
            mock_upload.invoke = MagicMock(return_value=fake_url)

            result = await generate_section_visuals(section, None, "", "page-123")

        assert result == [fake_url]

    @pytest.mark.asyncio
    async def test_logs_image_generation_and_upload_boundaries(self, caplog):
        """Generation/upload steps should be visible in terminal logs for debugging."""
        from app.workers.section_writer import generate_section_visuals

        visual = VisualPlan(type="ai_image", description="workflow diagram")
        section = _make_section(visuals=[visual])

        with patch("app.tools.nanobana_imggen.nanobana_imggen") as mock_imggen, \
             patch("app.tools.docmost_api.docmost_upload") as mock_upload:
            mock_imggen.invoke = MagicMock(return_value="fake_b64_data")
            mock_upload.invoke = MagicMock(return_value="https://cdn.docmost.com/uploads/workflow.png")
            caplog.set_level(logging.INFO, logger="uvicorn.error")

            result = await generate_section_visuals(section, None, "thread-visual", "page-123")

        assert result == ["https://cdn.docmost.com/uploads/workflow.png"]
        assert any(
            "thread_id=thread-visual" in record.message
            and "image_generation_start" in record.message
            and "workflow diagram" in record.message
            for record in caplog.records
        )
        assert any(
            "thread_id=thread-visual" in record.message
            and "image_upload_complete" in record.message
            and "workflow.png" in record.message
            for record in caplog.records
        )

    @pytest.mark.asyncio
    async def test_skips_upload_when_no_page_id(self):
        """When page_id is None, image is generated but not uploaded."""
        from app.workers.section_writer import generate_section_visuals

        visual = VisualPlan(type="ai_image", description="abstract mountain")
        section = _make_section(visuals=[visual])

        fake_b64 = "iVBORw0KGgoAAAANSUhEUg=="

        with patch("app.tools.nanobana_imggen.nanobana_imggen") as mock_imggen, \
             patch("app.tools.docmost_api.docmost_upload") as mock_upload:
            mock_imggen.invoke = MagicMock(return_value=fake_b64)
            mock_upload.invoke = MagicMock(return_value="some-url")

            result = await generate_section_visuals(section, None, "", None)

        # No upload should happen, so no URL returned
        assert result == []
        mock_upload.invoke.assert_not_called()

    @pytest.mark.asyncio
    async def test_handles_imggen_failure_gracefully(self):
        """If image generation fails, returns empty list without raising."""
        from app.workers.section_writer import generate_section_visuals

        visual = VisualPlan(type="ai_image", description="exploding volcano")
        section = _make_section(visuals=[visual])

        with patch("app.tools.nanobana_imggen.nanobana_imggen") as mock_imggen:
            mock_imggen.invoke = MagicMock(side_effect=Exception("API timeout"))

            result = await generate_section_visuals(section, None, "", "page-123")

        assert result == []

    @pytest.mark.asyncio
    async def test_handles_upload_failure_gracefully(self):
        """If upload fails, returns empty list without raising."""
        from app.workers.section_writer import generate_section_visuals

        visual = VisualPlan(type="ai_image", description="neon cityscape")
        section = _make_section(visuals=[visual])

        with patch("app.tools.nanobana_imggen.nanobana_imggen") as mock_imggen, \
             patch("app.tools.docmost_api.docmost_upload") as mock_upload:
            mock_imggen.invoke = MagicMock(return_value="fake_b64_data")
            mock_upload.invoke = MagicMock(side_effect=Exception("Storage error"))

            result = await generate_section_visuals(section, None, "", "page-123")

        assert result == []

    @pytest.mark.asyncio
    async def test_logs_image_upload_failure(self, caplog):
        """Upload failures should be visible in terminal logs."""
        from app.workers.section_writer import generate_section_visuals

        visual = VisualPlan(type="ai_image", description="neon cityscape")
        section = _make_section(visuals=[visual])

        with patch("app.tools.nanobana_imggen.nanobana_imggen") as mock_imggen, \
             patch("app.tools.docmost_api.docmost_upload") as mock_upload:
            mock_imggen.invoke = MagicMock(return_value="fake_b64_data")
            mock_upload.invoke = MagicMock(side_effect=Exception("Storage error"))
            caplog.set_level(logging.ERROR, logger="uvicorn.error")

            result = await generate_section_visuals(section, None, "thread-visual", "page-123")

        assert result == []
        assert any(
            "thread_id=thread-visual" in record.message
            and "image_generation_failed" in record.message
            and "Storage error" in record.message
            for record in caplog.records
        )

    @pytest.mark.asyncio
    async def test_materialize_section_visuals_inserts_generated_image_after_text_stabilizes(self):
        from app.models.draft import SectionDraft
        from app.workers.section_writer import materialize_section_visuals

        section = _make_section(
            visuals=[VisualPlan(type="ai_image", description="login flow illustration", position="before_section")]
        )
        draft = SectionDraft(section_id="s1", content="Finalized section body.", word_count=4)

        with patch("app.workers.section_writer.generate_section_visuals", new=AsyncMock(return_value=["https://cdn.example.com/login.png"])) as mock_generate:
            result = await materialize_section_visuals(
                draft=draft,
                section=section,
                asset_map=None,
                thread_id="thread-1",
                page_id="page-1",
            )

        mock_generate.assert_awaited_once()
        assert result.visuals_generated == ["https://cdn.example.com/login.png"]
        assert "https://cdn.example.com/login.png" in result.content
        assert result.content.index("![login flow illustration]") < result.content.index("Finalized section body.")

    @pytest.mark.asyncio
    async def test_materialize_section_visuals_reuses_source_image_without_ai_generation(self):
        from app.models.draft import SectionDraft
        from app.workers.section_writer import materialize_section_visuals

        section = _make_section(
            visuals=[VisualPlan(type="reuse_image", description="reference screenshot", source_asset_id="img-1")]
        )
        draft = SectionDraft(section_id="s1", content="Stable content.", word_count=2)
        asset_map = _make_asset_map([
            AssetItem(
                id="img-1",
                type="image",
                content="https://cdn.example.com/source.png",
                summary="Source screenshot",
            )
        ])

        with patch("app.workers.section_writer.generate_section_visuals", new=AsyncMock(return_value=["https://cdn.example.com/unused.png"])) as mock_generate:
            result = await materialize_section_visuals(
                draft=draft,
                section=section,
                asset_map=asset_map,
                thread_id="thread-1",
                page_id="page-1",
            )

        mock_generate.assert_not_awaited()
        assert result.visuals_generated == []
        assert "https://cdn.example.com/source.png" in result.content

    @pytest.mark.asyncio
    async def test_materialize_section_visuals_preserves_docmost_internal_image_paths(self):
        from app.models.draft import SectionDraft
        from app.workers.section_writer import materialize_section_visuals

        section = _make_section(
            visuals=[VisualPlan(type="reuse_image", description="reference screenshot", source_asset_id="img-1")]
        )
        draft = SectionDraft(section_id="s1", content="Stable content.", word_count=2)
        asset_map = _make_asset_map([
            AssetItem(
                id="img-1",
                type="image",
                content="/api/files/file-1/采购退货单sop_a507a453.jpg",
                summary="Source screenshot",
            )
        ])

        result = await materialize_section_visuals(
            draft=draft,
            section=section,
            asset_map=asset_map,
            thread_id="thread-1",
            page_id="page-1",
        )

        assert "/api/files/file-1/采购退货单sop_a507a453.jpg" in result.content

    @pytest.mark.asyncio
    async def test_materialize_section_visuals_still_encodes_external_image_urls(self):
        from app.models.draft import SectionDraft
        from app.workers.section_writer import materialize_section_visuals

        section = _make_section(
            visuals=[VisualPlan(type="reuse_image", description="reference screenshot", source_asset_id="img-1")]
        )
        draft = SectionDraft(section_id="s1", content="Stable content.", word_count=2)
        asset_map = _make_asset_map([
            AssetItem(
                id="img-1",
                type="image",
                content="https://cdn.example.com/采购退货单 sop.jpg",
                summary="Source screenshot",
            )
        ])

        result = await materialize_section_visuals(
            draft=draft,
            section=section,
            asset_map=asset_map,
            thread_id="thread-1",
            page_id="page-1",
        )

        assert "https://cdn.example.com/%E9%87%87%E8%B4%AD%E9%80%80%E8%B4%A7%E5%8D%95%20sop.jpg" in result.content

    @pytest.mark.asyncio
    async def test_materialize_section_visuals_resolves_asset_placeholders_to_exact_urls(self):
        from app.models.draft import SectionDraft
        from app.workers.section_writer import materialize_section_visuals

        section = _make_section(assets=["img-1"])
        draft = SectionDraft(
            section_id="s1",
            content="正文段落\n\n![采购退货流程](asset://img-1)",
            word_count=2,
        )
        asset_map = _make_asset_map([
            AssetItem(
                id="img-1",
                type="image",
                content="/api/files/file-1/采购退货流程.png",
                summary="Source screenshot",
            )
        ])

        result = await materialize_section_visuals(
            draft=draft,
            section=section,
            asset_map=asset_map,
            thread_id="thread-1",
            page_id="page-1",
        )

        assert "![采购退货流程](/api/files/file-1/采购退货流程.png)" in result.content
        assert "asset://img-1" not in result.content

    @pytest.mark.asyncio
    async def test_materialize_section_visuals_reuses_existing_generated_image_without_regeneration(self):
        from app.models.draft import SectionDraft
        from app.workers.section_writer import materialize_section_visuals

        section = _make_section(
            visuals=[VisualPlan(type="ai_image", description="generated architecture", position="before_section")]
        )
        draft = SectionDraft(
            section_id="s1",
            content="Stable content without the image.",
            word_count=5,
            visuals_generated=["https://cdn.example.com/generated-1.png"],
        )

        with patch("app.workers.section_writer.generate_section_visuals", new=AsyncMock(return_value=["https://cdn.example.com/generated-2.png"])) as mock_generate:
            result = await materialize_section_visuals(
                draft=draft,
                section=section,
                asset_map=None,
                thread_id="thread-1",
                page_id="page-1",
            )

        mock_generate.assert_not_awaited()
        assert result.visuals_generated == ["https://cdn.example.com/generated-1.png"]
        assert "https://cdn.example.com/generated-1.png" in result.content
