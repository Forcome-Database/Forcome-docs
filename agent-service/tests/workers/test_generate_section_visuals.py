"""Tests for generate_section_visuals() in SectionWriter Worker."""
from __future__ import annotations

import asyncio
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
) -> SectionPlan:
    return SectionPlan(
        id=sid,
        title="Test Section",
        visuals=visuals or [],
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
