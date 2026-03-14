"""Tests for merge_proposals tool."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch
import json

import pytest

from app.models.asset_map import AssetMap, AssetItem


def _make_asset_map_multi_doc() -> AssetMap:
    return AssetMap(
        items=[
            AssetItem(id="a1", type="heading_structure", source="doc_a.pdf", content="## Introduction"),
            AssetItem(id="a2", type="text", source="doc_a.pdf", content="This is the intro text from doc A." * 10),
            AssetItem(id="a3", type="heading_structure", source="doc_a.pdf", content="## Methodology"),
            AssetItem(id="b1", type="heading_structure", source="doc_b.pdf", content="## Results"),
            AssetItem(id="b2", type="text", source="doc_b.pdf", content="Results content from doc B." * 15),
            AssetItem(id="b3", type="heading_structure", source="doc_b.pdf", content="## Conclusion"),
        ]
    )


class TestSummarizeSources:
    def test_groups_items_by_source(self):
        from app.orchestrator.tools.merge_proposals import _summarize_sources
        asset_map = _make_asset_map_multi_doc()
        summary = _summarize_sources(asset_map)
        assert "doc_a.pdf" in summary
        assert "doc_b.pdf" in summary

    def test_includes_heading_info(self):
        from app.orchestrator.tools.merge_proposals import _summarize_sources
        asset_map = _make_asset_map_multi_doc()
        summary = _summarize_sources(asset_map)
        assert "Introduction" in summary or "Methodology" in summary

    def test_empty_asset_map_returns_empty_string(self):
        from app.orchestrator.tools.merge_proposals import _summarize_sources
        empty_map = AssetMap(items=[])
        summary = _summarize_sources(empty_map)
        assert summary == ""


class TestMergeProposalClass:
    def test_to_dict_returns_all_fields(self):
        from app.orchestrator.tools.merge_proposals import MergeProposal
        p = MergeProposal(
            title="Unified Doc",
            description="Merge all sections",
            structure=[{"level": 2, "title": "Intro", "source_doc": "doc_a.pdf"}],
        )
        d = p.to_dict()
        assert d["title"] == "Unified Doc"
        assert d["description"] == "Merge all sections"
        assert len(d["structure"]) == 1


class TestGenerateMergeProposals:
    @pytest.mark.asyncio
    async def test_returns_proposals_list(self):
        asset_map = _make_asset_map_multi_doc()
        proposals_json = json.dumps([
            {"title": "方案 1", "description": "Sequential merge", "structure": [{"level": 2, "title": "From A", "source_doc": "doc_a.pdf"}]},
            {"title": "方案 2", "description": "Thematic merge", "structure": [{"level": 2, "title": "Mixed", "source_doc": "new"}]},
        ])

        mock_result = MagicMock()
        mock_result.data = proposals_json

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(return_value=mock_result)

        with patch("app.orchestrator.tools.merge_proposals.Agent", return_value=mock_agent), \
             patch("app.orchestrator.tools.merge_proposals.create_pydantic_ai_model", return_value=MagicMock()), \
             patch("app.orchestrator.tools.merge_proposals.emit", new=AsyncMock()):
            from app.orchestrator.tools.merge_proposals import generate_merge_proposals
            proposals = await generate_merge_proposals(
                asset_map=asset_map,
                user_message="Merge these docs",
                thread_id="t1",
            )

        assert len(proposals) == 2
        assert proposals[0].title == "方案 1"

    @pytest.mark.asyncio
    async def test_bad_json_returns_empty_list(self):
        asset_map = _make_asset_map_multi_doc()

        mock_result = MagicMock()
        mock_result.data = "This is not JSON at all"

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(return_value=mock_result)

        with patch("app.orchestrator.tools.merge_proposals.Agent", return_value=mock_agent), \
             patch("app.orchestrator.tools.merge_proposals.create_pydantic_ai_model", return_value=MagicMock()), \
             patch("app.orchestrator.tools.merge_proposals.emit", new=AsyncMock()):
            from app.orchestrator.tools.merge_proposals import generate_merge_proposals
            proposals = await generate_merge_proposals(
                asset_map=asset_map,
                user_message="Merge these",
                thread_id="t1",
            )

        assert proposals == []

    @pytest.mark.asyncio
    async def test_caps_at_three_proposals(self):
        asset_map = _make_asset_map_multi_doc()
        many_proposals = [
            {"title": f"方案 {i}", "description": f"Desc {i}", "structure": []}
            for i in range(1, 6)  # 5 proposals
        ]
        proposals_json = json.dumps(many_proposals)

        mock_result = MagicMock()
        mock_result.data = proposals_json

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(return_value=mock_result)

        with patch("app.orchestrator.tools.merge_proposals.Agent", return_value=mock_agent), \
             patch("app.orchestrator.tools.merge_proposals.create_pydantic_ai_model", return_value=MagicMock()), \
             patch("app.orchestrator.tools.merge_proposals.emit", new=AsyncMock()):
            from app.orchestrator.tools.merge_proposals import generate_merge_proposals
            proposals = await generate_merge_proposals(
                asset_map=asset_map,
                user_message="Merge",
                thread_id="t1",
            )

        assert len(proposals) <= 3

    @pytest.mark.asyncio
    async def test_emits_step_events(self):
        asset_map = _make_asset_map_multi_doc()
        emitted = []

        async def capture_emit(thread_id, event):
            emitted.append(event)

        mock_result = MagicMock()
        mock_result.data = "[]"

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(return_value=mock_result)

        with patch("app.orchestrator.tools.merge_proposals.Agent", return_value=mock_agent), \
             patch("app.orchestrator.tools.merge_proposals.create_pydantic_ai_model", return_value=MagicMock()), \
             patch("app.orchestrator.tools.merge_proposals.emit", new=capture_emit):
            from app.orchestrator.tools.merge_proposals import generate_merge_proposals
            await generate_merge_proposals(
                asset_map=asset_map,
                user_message="Merge",
                thread_id="t1",
            )

        steps = [e["step"] for e in emitted]
        assert "merge_proposals" in steps
        event_types = [e["type"] for e in emitted]
        assert "step_start" in event_types
        assert "step_done" in event_types
