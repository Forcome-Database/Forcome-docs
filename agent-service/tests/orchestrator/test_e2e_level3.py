import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.review import ReviewIssue, ReviewReport
from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest
from app.orchestrator.session_store import session_store


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
async def test_level3_allows_accepting_non_blocking_review_issues():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a concise technical note.",
        thread_id="test-l3-review-accept",
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
        mock_brief.return_value = CreationBrief(audience="developers", goal="technical note", target_length=300)
        mock_blueprint.return_value = CreationBlueprint(
            title="Technical Note",
            total_word_budget=300,
            sections=[SectionPlan(id="s1", title="Overview", level=2, word_budget=300)],
        )
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"confirmed": True},
                {"type": "review", "skip": True},
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        drafts = [SectionDraft(section_id="s1", content="content", word_count=330)]
        mock_write.return_value = drafts
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(
            overall_score=78,
            issues=[
                ReviewIssue(
                    id="issue-1",
                    section_id="s1",
                    severity="warning",
                    category="content",
                    description="The note could be more concise.",
                    suggestion="Tighten the wording.",
                    auto_fixable=False,
                ),
                ReviewIssue(
                    id="issue-2",
                    section_id="s1",
                    severity="info",
                    category="length",
                    description="The section is slightly above the target budget.",
                    suggestion="Trim 20 to 30 words if desired.",
                    auto_fixable=False,
                ),
            ],
            user_decision_needed=["issue-1", "issue-2"],
        )
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_finalize.return_value = "final content"
        mock_draft.save_draft = MagicMock()

        result = await engine.run(request)

    assert result == "final content"
    mock_finalize.assert_awaited_once()
    blocked_events = [
        call.args[1]
        for call in mock_emit.await_args_list
        if len(call.args) == 2 and call.args[1].get("type") == "blocked"
    ]
    assert blocked_events == []


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


@pytest.mark.asyncio
async def test_level3_auto_applies_allowed_blueprint_patch_and_records_audit():
    session_store.clear()
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a system design document.",
        thread_id="test-l3-blueprint-auto-patch",
        workspace_id="ws-test",
        intent_route="document_create",
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
        from app.models.blueprint import SectionPlan, VisualPlan

        mock_complexity.return_value = {"level": 3, "reasoning": "creation keyword"}
        mock_research.return_value = []
        mock_brief.return_value = CreationBrief(audience="developers", goal="design doc", target_length=1200)
        confirmed_blueprint = CreationBlueprint(
            title="System Design",
            total_word_budget=1200,
            sections=[
                SectionPlan(
                    id="s1",
                    title="Overview",
                    level=2,
                    word_budget=1200,
                    assets=["asset-1"],
                    must_cover=["context"],
                    visuals=[
                        VisualPlan(
                            type="ai_image",
                            description="System overview illustration",
                            position="before_section",
                        )
                    ],
                )
            ],
        )
        patched_blueprint = confirmed_blueprint.model_copy(deep=True)
        patched_blueprint.sections[0].must_cover.append("success metrics")
        mock_blueprint.return_value = confirmed_blueprint
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"blueprint": patched_blueprint.model_dump()},
                None,
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        drafts = [SectionDraft(section_id="s1", content="content", word_count=1200)]
        mock_write.return_value = drafts
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_finalize.return_value = "final content"
        mock_draft.save_draft = MagicMock()

        result = await engine.run(request)

    assert result == "final content"
    snapshot = session_store.get_session(request.thread_id)
    assert snapshot is not None
    assert snapshot.blueprint is not None
    assert snapshot.blueprint.sections[0].must_cover == ["context", "success metrics"]
    assert len(snapshot.blueprint_change_audit) == 1
    assert snapshot.blueprint_change_audit[0].decision == "auto_patch"
    blueprint_events = [
        call.args[1]
        for call in mock_emit.await_args_list
        if len(call.args) == 2 and call.args[1].get("type") == "await_input" and call.args[1].get("phase") == "blueprint"
    ]
    assert len(blueprint_events) == 1


@pytest.mark.asyncio
async def test_level3_reopens_blueprint_when_patch_requires_reconfirmation():
    session_store.clear()
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a system design document.",
        thread_id="test-l3-blueprint-reconfirm",
        workspace_id="ws-test",
        intent_route="document_create",
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
        mock_brief.return_value = CreationBrief(audience="developers", goal="design doc", target_length=1200)
        confirmed_blueprint = CreationBlueprint(
            title="System Design",
            total_word_budget=1200,
            sections=[SectionPlan(id="s1", title="Overview", level=2, word_budget=1200)],
        )
        patched_blueprint = confirmed_blueprint.model_copy(deep=True)
        patched_blueprint.title = "Renamed System Design"
        mock_blueprint.return_value = confirmed_blueprint
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"blueprint": patched_blueprint.model_dump()},
                {"confirmed": True},
                None,
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        drafts = [SectionDraft(section_id="s1", content="content", word_count=1200)]
        mock_write.return_value = drafts
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_finalize.return_value = "final content"
        mock_draft.save_draft = MagicMock()

        result = await engine.run(request)

    assert result == "final content"
    snapshot = session_store.get_session(request.thread_id)
    assert snapshot is not None
    assert snapshot.blueprint is not None
    assert snapshot.blueprint.title == "Renamed System Design"
    assert snapshot.pending_blueprint_patch is None
    blueprint_events = [
        call.args[1]
        for call in mock_emit.await_args_list
        if len(call.args) == 2 and call.args[1].get("type") == "await_input" and call.args[1].get("phase") == "blueprint"
    ]
    assert len(blueprint_events) == 2
    assert blueprint_events[1]["data"]["blueprint"]["title"] == "Renamed System Design"


@pytest.mark.asyncio
async def test_level3_recovers_section_locally_before_review():
    engine = OrchestratorEngine()

    request = OrchestratorRequest(
        user_message="Write a system design document.",
        thread_id="test-l3-local-recovery",
        workspace_id="ws-test",
        intent_route="document_create",
    )

    with patch("app.orchestrator.engine.analyze_task_complexity") as mock_complexity, \
         patch("app.orchestrator.tools.evidence.research_tool", new_callable=AsyncMock) as mock_research, \
         patch("app.orchestrator.engine.generate_brief") as mock_brief, \
         patch("app.orchestrator.engine.generate_blueprint") as mock_blueprint, \
         patch("app.orchestrator.engine.interaction_registry") as mock_registry, \
         patch("app.orchestrator.tools.write_tools.write_single_section", new_callable=AsyncMock) as mock_write_single, \
         patch("app.orchestrator.tools.write_tools.revise_section_draft", new_callable=AsyncMock) as mock_revise_section, \
         patch("app.orchestrator.tools.write_tools.materialize_section_visuals", new_callable=AsyncMock, create=True) as mock_materialize_visuals, \
         patch("app.orchestrator.tools.write_tools.emit", new_callable=AsyncMock), \
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
        mock_brief.return_value = CreationBrief(audience="developers", goal="design doc", target_length=400)
        mock_blueprint.return_value = CreationBlueprint(
            title="System Design",
            total_word_budget=400,
            sections=[
                SectionPlan(
                    id="s1",
                    title="Overview",
                    level=2,
                    word_budget=400,
                    assets=["asset-1"],
                )
            ],
        )
        mock_registry.wait_for_response = AsyncMock(
            side_effect=[
                {"confirmed": True},
                {"confirmed": True},
            ]
        )
        mock_registry.register = MagicMock()
        mock_registry.cleanup = MagicMock()
        mock_write_single.return_value = SectionDraft(section_id="s1", content="Too short.", word_count=20, assets_used=[])
        mock_revise_section.return_value = SectionDraft(
            section_id="s1",
            content="Recovered draft with explicit asset use.",
            word_count=400,
            assets_used=["asset-1"],
        )
        mock_materialize_visuals.side_effect = lambda draft, **_: draft
        mock_consistency.return_value = []
        mock_evaluate.return_value = ReviewReport(overall_score=90, issues=[])
        mock_autofix.side_effect = lambda drafts, issues, levels: (drafts, 0)
        mock_finalize.return_value = "final content"
        mock_draft.save_draft = MagicMock()

        result = await engine.run(request)

    assert result == "final content"
    assert mock_write_single.await_count == 1
    mock_revise_section.assert_awaited_once()
    mock_materialize_visuals.assert_awaited_once()
    snapshot = session_store.get_session(request.thread_id)
    assert snapshot is not None
    assert snapshot.draft_sections[0].content == "Recovered draft with explicit asset use."
