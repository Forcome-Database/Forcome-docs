import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.review import ReviewIssue, ReviewReport
from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest


@pytest.mark.asyncio
async def test_level3_full_pipeline():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a document about microservice architecture.",
        thread_id="test-l3-thread",
        workspace_id="ws-test",
        intent_route="document_create",
        page_id="page-l3-test",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.tools.evidence.research_tool", new_callable=AsyncMock) as mock_research, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import CreationBrief, CreationBlueprint, SectionDraft
        from app.models.blueprint import SectionPlan

        mock_complexity.return_value = {"level": 3, "reasoning": "creation keyword"}
        mock_research.return_value = []
        mock_brief.return_value = CreationBrief(
            audience="engineering team",
            goal="technical blog post",
            target_length=3000,
            style="professional",
            tone="friendly",
        )
        mock_blueprint.return_value = CreationBlueprint(
            title="Microservice Architecture",
            total_word_budget=3000,
            sections=[
                SectionPlan(id="s1", title="Introduction", level=2, word_budget=500),
                SectionPlan(id="s2", title="Core Concepts", level=2, word_budget=1000),
                SectionPlan(id="s3", title="Practical Guidance", level=2, word_budget=1000),
                SectionPlan(id="s4", title="Conclusion", level=2, word_budget=500),
            ],
        )
        mock_registry.wait_for_response = AsyncMock(return_value={"confirmed": True})
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        mock_write.return_value = [
            SectionDraft(section_id="s1", content="intro", word_count=500),
            SectionDraft(section_id="s2", content="concepts", word_count=1000),
            SectionDraft(section_id="s3", content="guidance", word_count=1000),
            SectionDraft(section_id="s4", content="summary", word_count=500),
        ]
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=85, issues=[])
        mock_autofix.return_value = (mock_write.return_value, 0)
        mock_finalize.return_value = "Full document content"
        mock_draft.save_draft = MagicMock()

        await engine.run(request)

    mock_complexity.assert_called_once()
    mock_brief.assert_called_once()
    mock_blueprint.assert_called_once()
    mock_write.assert_called_once()
    mock_finalize.assert_called_once()


@pytest.mark.asyncio
async def test_level3_with_files():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a report from these source files.",
        thread_id="test-l3-files",
        workspace_id="ws-test",
        intent_route="document_create",
        files=[
            {"content_b64": "dGVzdA==", "filename": "a.pdf", "mimetype": "application/pdf"},
            {"content_b64": "dGVzdA==", "filename": "b.pdf", "mimetype": "application/pdf"},
        ],
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.engine.parse_assets_tool") as mock_parse, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import AssetMap, CreationBrief, CreationBlueprint, SectionDraft
        from app.models.blueprint import SectionPlan

        mock_complexity.return_value = {"level": 3, "reasoning": "multi file"}
        mock_parse.return_value = AssetMap(source_word_count=5000)
        mock_brief.return_value = CreationBrief(audience="general", goal="report", target_length=5000)
        mock_blueprint.return_value = CreationBlueprint(
            title="Report",
            total_word_budget=5000,
            sections=[SectionPlan(id="s1", title="Summary", level=2, word_budget=5000)],
        )
        mock_registry.wait_for_response = AsyncMock(return_value={"confirmed": True})
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        mock_write.return_value = [SectionDraft(section_id="s1", content="content", word_count=5000)]
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.return_value = (mock_write.return_value, 0)
        mock_finalize.return_value = "content"
        mock_draft.save_draft = MagicMock()

        await engine.run(request)

    mock_parse.assert_called_once()


@pytest.mark.asyncio
async def test_level3_blocks_before_brief_when_required_reference_url_evidence_fails():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Use https://example.com/spec to write a product brief.",
        thread_id="test-l3-required-evidence",
        workspace_id="ws-test",
        intent_route="document_create",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.tools.evidence.research_tool") as mock_research, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.emit") as mock_emit:

        from app.models import CreationBrief

        mock_complexity.return_value = {"level": 3, "reasoning": "source-anchored prompt"}
        mock_brief.return_value = CreationBrief(
            audience="product team",
            goal="brief",
            target_length=1200,
        )
        mock_registry.wait_for_response = AsyncMock(
            side_effect=AssertionError("required evidence failure must not reach await_input")
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()

        async def research_side_effect(query, sources=None, thread_id="", workspace_id=""):
            if sources == ["web_crawl"]:
                raise RuntimeError("crawl timeout")
            return [{"source": "web_search", "content": "index result"}]

        mock_research.side_effect = research_side_effect

        result = await engine.run(request)

    assert result == ""
    mock_brief.assert_not_called()
    blocked_events = [
        call.args[1]
        for call in mock_emit.await_args_list
        if len(call.args) == 2 and call.args[1].get("type") == "blocked"
    ]
    assert blocked_events == [
        {
            "type": "blocked",
            "kind": "evidence",
            "message": "Required evidence could not be collected",
            "required_action": "Retry the failed evidence step or remove the missing source",
            "allowed_resolutions": ["retry", "remove_source"],
        }
    ]
    assert not any(
        len(call.args) == 2 and call.args[1].get("type") == "await_input"
        for call in mock_emit.await_args_list
    )
    assert not any(
        len(call.args) == 2 and call.args[1].get("type") == "draft_patch"
        for call in mock_emit.await_args_list
    )


@pytest.mark.asyncio
async def test_level3_reopens_review_after_selected_fix_until_user_skips():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a system design document.",
        thread_id="test-l3-review-loop",
        workspace_id="ws-test",
        intent_route="document_create",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.tools.evidence.research_tool", new_callable=AsyncMock) as mock_research, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.orchestrator.engine.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.fix_selected_issues") as mock_fix_selected, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import CreationBrief, CreationBlueprint, SectionDraft
        from app.models.blueprint import SectionPlan

        mock_complexity.return_value = {"level": 3, "reasoning": "creation keyword"}
        mock_research.return_value = []
        mock_brief.return_value = CreationBrief(audience="developers", goal="design doc", target_length=1200)
        mock_blueprint.return_value = CreationBlueprint(
            title="System Design",
            total_word_budget=1200,
            sections=[SectionPlan(id="s1", title="Overview", level=2, word_budget=1200)],
        )
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"confirmed": True},
                {"type": "review", "selected_issue_ids": ["issue-1"]},
                {"type": "review", "selected_issue_ids": [], "skip": True},
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        drafts = [SectionDraft(section_id="s1", content="content", word_count=1200)]
        mock_write.return_value = drafts
        mock_consistency.return_value = []
        mock_evaluate.side_effect = [
            ReviewReport(
                overall_score=80,
                issues=[
                    ReviewIssue(
                        id="issue-1",
                        section_id="s1",
                        severity="warning",
                        category="content",
                        description="Add a concrete example",
                        suggestion="Include a worked example",
                        auto_fixable=False,
                    )
                ],
                user_decision_needed=["issue-1"],
            ),
            ReviewReport(
                overall_score=82,
                issues=[
                    ReviewIssue(
                        id="issue-2",
                        section_id="s1",
                        severity="warning",
                        category="content",
                        description="Transition is still weak",
                        suggestion="Improve the transition",
                        auto_fixable=False,
                    )
                ],
                user_decision_needed=["issue-2"],
            ),
        ]
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_fix_selected.return_value = drafts
        mock_finalize.return_value = "final content"
        mock_draft.save_draft = MagicMock()

        await engine.run(request)

    assert mock_evaluate.await_count == 2
    mock_fix_selected.assert_awaited_once()
    review_events = [
        call.args[1]
        for call in mock_emit.await_args_list
        if len(call.args) == 2 and call.args[1].get("type") == "await_input" and call.args[1].get("phase") == "review"
    ]
    assert len(review_events) == 2
    assert any(
        len(call.args) == 2 and call.args[1].get("type") == "content_clear"
        for call in mock_emit.await_args_list
    )


@pytest.mark.asyncio
async def test_level3_blocks_finalize_when_section_alignment_is_broken():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a system design document.",
        thread_id="test-l3-alignment",
        workspace_id="ws-test",
        intent_route="document_create",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.tools.evidence.research_tool", new_callable=AsyncMock) as mock_research, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.orchestrator.engine.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import CreationBrief, CreationBlueprint, SectionDraft
        from app.models.blueprint import SectionPlan

        mock_complexity.return_value = {"level": 3, "reasoning": "creation keyword"}
        mock_research.return_value = []
        mock_brief.return_value = CreationBrief(audience="developers", goal="design doc", target_length=1200)
        mock_blueprint.return_value = CreationBlueprint(
            title="System Design",
            total_word_budget=1200,
            sections=[
                SectionPlan(id="s1", title="Overview", level=2, word_budget=600),
                SectionPlan(id="s2", title="Approach", level=2, word_budget=600),
            ],
        )
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"confirmed": True},
                None,
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        mock_write.return_value = [SectionDraft(section_id="s1", content="only one section", word_count=600)]
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_draft.save_draft = MagicMock()

        with pytest.raises(RuntimeError):
            await engine.run(request)

    mock_finalize.assert_not_called()


@pytest.mark.asyncio
async def test_level3_optional_web_search_failure_does_not_block_blank_page_creation():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write an overview of microservice architecture.",
        thread_id="test-l3-optional-research",
        workspace_id="ws-test",
        intent_route="document_create",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.tools.evidence.research_tool", side_effect=RuntimeError("search unavailable")) as mock_research, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.engine.write_all_sections") as mock_write, \
         patch("app.orchestrator.engine.evaluate_quality") as mock_evaluate, \
         patch("app.orchestrator.engine.run_consistency_checks") as mock_consistency, \
         patch("app.orchestrator.engine.apply_auto_fixes") as mock_autofix, \
         patch("app.orchestrator.engine.finalize_and_emit") as mock_finalize, \
         patch("app.orchestrator.engine.emit") as mock_emit, \
         patch("app.orchestrator.engine.draft_store") as mock_draft:

        from app.models import CreationBrief, CreationBlueprint, SectionDraft
        from app.models.blueprint import SectionPlan

        mock_complexity.return_value = {"level": 3, "reasoning": "blank page create"}
        mock_brief.return_value = CreationBrief(audience="developers", goal="overview", target_length=1200)
        mock_blueprint.return_value = CreationBlueprint(
            title="Microservices Overview",
            total_word_budget=1200,
            sections=[SectionPlan(id="s1", title="Overview", level=2, word_budget=1200)],
        )
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"confirmed": True},
                None,
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        mock_write.return_value = [SectionDraft(section_id="s1", content="content", word_count=1200)]
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_finalize.return_value = "final content"
        mock_draft.save_draft = MagicMock()

        result = await engine.run(request)

    assert result == "final content"
    mock_research.assert_awaited_once()
    mock_brief.assert_called_once()
    assert any(
        len(call.args) == 2
        and call.args[1].get("type") == "await_input"
        and call.args[1].get("phase") == "brief"
        for call in mock_emit.await_args_list
    )
    assert not any(
        len(call.args) == 2 and call.args[1].get("type") == "blocked"
        for call in mock_emit.await_args_list
    )
