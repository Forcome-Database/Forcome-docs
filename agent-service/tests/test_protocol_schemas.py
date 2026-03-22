import pytest
from pydantic import ValidationError

from app.models.document_task import (
    DocumentTaskApplyPayload,
    DocumentTaskEnvelope,
    DocumentTaskRollbackPayload,
)
from app.models.session import CreationSessionSnapshot
from app.schemas.request import AgentResumeRequest, AgentRunRequest
from app.schemas.response import AwaitInputEvent, BlockedEvent, CancelledEvent, DraftPatchEvent, SessionEvent


def test_agent_resume_request_accepts_typed_chunk2_resume_commands():
    confirm_brief = AgentResumeRequest.model_validate(
        {
            "session_id": "session-1",
            "resume_value": {
                "type": "confirm_brief",
                "brief": {"audience": "engineers"},
            },
        }
    )
    confirm_blueprint = AgentResumeRequest.model_validate(
        {
            "session_id": "session-1",
            "resume_value": {
                "type": "confirm_blueprint",
                "blueprint": {"title": "Doc", "sections": []},
            },
        }
    )
    fix_selected = AgentResumeRequest.model_validate(
        {
            "session_id": "session-1",
            "resume_value": {
                "type": "fix_selected_issues",
                "selected_issue_ids": ["issue-1"],
                "feedback": "Tighten the opening",
            },
        }
    )

    assert confirm_brief.resume_value.type == "confirm_brief"
    assert confirm_blueprint.resume_value.type == "confirm_blueprint"
    assert fix_selected.resume_value.type == "fix_selected_issues"
    assert fix_selected.resume_value.selected_issue_ids == ["issue-1"]


def test_agent_run_request_accepts_document_task_contract_without_raw_history_inheritance():
    request = AgentRunRequest.model_validate(
        {
            "user_message": "Optimize this uploaded document",
            "files": [
                {
                    "filename": "guide.md",
                    "mimetype": "text/markdown",
                    "content_b64": "Z3VpZGU=",
                }
            ],
            "intent_route": "document_transform",
            "scope": "uploaded_document",
            "source_policy": "preserve_source",
            "document_task": {
                "task_id": "task-1",
                "task_type": "document_transform",
                "source_scope": "uploaded_document",
                "mode": "strict_preservation",
                "deep_collaboration_enabled": False,
                "status": "awaiting_review",
                "task_summary": {
                    "summary_source": "structured_summary",
                    "include_raw_history": False,
                    "summary": "Optimize formatting while preserving structure.",
                },
            },
        }
    )

    assert request.document_task is not None
    assert request.document_task.mode == "strict_preservation"
    assert request.document_task.deep_collaboration_enabled is False
    assert request.document_task.task_summary.summary_source == "structured_summary"
    assert request.document_task.task_summary.include_raw_history is False


def test_agent_resume_request_rejects_legacy_resume_payloads():
    with pytest.raises(ValidationError):
        AgentResumeRequest.model_validate(
            {
                "thread_id": "thread-1",
                "resume_value": {"answers": "Focus on rollback and retries."},
            }
        )


def test_document_task_contract_accepts_mixed_granularity_diff_and_explicit_apply_rollback_payloads():
    envelope = DocumentTaskEnvelope.model_validate(
        {
            "task": {
                "task_id": "task-1",
                "task_type": "document_transform",
                "source_scope": "uploaded_document",
                "mode": "strict_preservation",
                "status": "ready_to_apply",
                "task_summary": {
                    "summary_source": "structured_summary",
                    "include_raw_history": False,
                    "summary": "Optimize the source document conservatively.",
                },
                "diff_set": [
                    {
                        "diff_id": "diff-1",
                        "block_id": "block-1",
                        "granularity": "block",
                        "text_diff": {
                            "granularity": "text",
                            "format": "line",
                        },
                    }
                ],
            },
            "apply": {
                "task_id": "task-1",
                "accepted_diff_ids": ["diff-1"],
                "create_rollback_snapshot": True,
            },
            "rollback": {
                "task_id": "task-1",
                "rollback_ref": "rollback-1",
            },
        }
    )

    assert envelope.task.diff_set[0].granularity == "block"
    assert envelope.task.diff_set[0].text_diff is not None
    assert envelope.task.diff_set[0].text_diff.granularity == "text"
    assert envelope.apply.create_rollback_snapshot is True
    assert envelope.rollback.rollback_ref == "rollback-1"


def test_explicit_apply_and_rollback_payload_models_exist():
    apply_payload = DocumentTaskApplyPayload.model_validate(
        {
            "task_id": "task-1",
            "accepted_diff_ids": ["diff-1"],
            "create_rollback_snapshot": True,
        }
    )
    rollback_payload = DocumentTaskRollbackPayload.model_validate(
        {
            "task_id": "task-1",
            "rollback_ref": "rollback-1",
        }
    )

    assert apply_payload.accepted_diff_ids == ["diff-1"]
    assert rollback_payload.rollback_ref == "rollback-1"

    with pytest.raises(ValidationError):
        AgentResumeRequest.model_validate(
            {
                "thread_id": "thread-1",
                "resume_value": {
                    "action": "confirm",
                    "confirmed_outline": "## Overview\n## Workflow",
                },
            }
        )


def test_await_input_event_requires_user_visible_typed_phase_payload_match():
    event = AwaitInputEvent.model_validate(
        {
            "type": "await_input",
            "phase": "brief",
            "data": {
                "type": "brief",
                "brief": {
                    "audience": "engineers",
                    "goal": "Explain the system",
                    "target_length": 1200,
                    "length_tolerance": 0.1,
                    "style": "technical",
                    "tone": "professional",
                    "structure_strategy": "ai_recommend",
                    "image_strategy": "none",
                    "constraints": [],
                },
            },
        }
    )

    assert event.phase == "brief"
    assert event.data.type == "brief"
    assert event.data.brief.goal == "Explain the system"


def test_review_await_input_event_accepts_typed_report_payload():
    event = AwaitInputEvent.model_validate(
        {
            "type": "await_input",
            "phase": "review",
            "data": {
                "type": "review",
                "report": {
                    "overall_score": 82,
                    "length_compliance": 0.96,
                    "asset_reuse_rate": 0.5,
                    "issues": [],
                    "auto_fixed_count": 1,
                    "user_decision_needed": [],
                },
            },
        }
    )

    assert event.phase == "review"
    assert event.data.type == "review"
    assert event.data.report.overall_score == 82


def test_await_input_event_rejects_legacy_outline_phase():
    with pytest.raises(ValidationError):
        AwaitInputEvent.model_validate(
            {
                "type": "await_input",
                "phase": "outline",
                "data": {
                    "type": "outline",
                    "outline": "## Windows Installation\n## Verification",
                },
            }
        )


def test_cancelled_event_schema_exists():
    event = CancelledEvent.model_validate({"type": "cancelled"})

    assert event.type == "cancelled"


def test_session_event_schema_supports_session_id_and_thread_id():
    event = SessionEvent.model_validate(
        {
            "type": "session",
            "session_id": "session-1",
            "thread_id": "thread-1",
        }
    )

    assert event.session_id == "session-1"
    assert event.thread_id == "thread-1"


def test_blocked_event_schema_accepts_structured_resolution_metadata():
    event = BlockedEvent.model_validate(
        {
            "type": "blocked",
            "kind": "evidence",
            "message": "Source page could not be read",
            "required_action": "Resolve the source issue before continuing",
            "allowed_resolutions": ["retry", "remove_source"],
        }
    )

    assert event.kind == "evidence"
    assert event.required_action == "Resolve the source issue before continuing"
    assert event.allowed_resolutions == ["retry", "remove_source"]


def test_draft_patch_event_schema_accepts_markdown_and_section_patches():
    event = DraftPatchEvent.model_validate(
        {
            "type": "draft_patch",
            "markdown": "# Title\n\n## Intro\n\nContent",
            "sections": [
                {
                    "node_id": "section:intro",
                    "section_id": "intro",
                    "title": "Intro",
                    "level": 2,
                    "content": "Content",
                }
            ],
        }
    )

    assert event.markdown.startswith("# Title")
    assert event.sections[0].node_id == "section:intro"
    assert event.sections[0].section_id == "intro"
    assert event.sections[0].content == "Content"


def test_creation_session_snapshot_preserves_evidence_metadata():
    snapshot = CreationSessionSnapshot.model_validate(
        {
            "session_id": "session-1",
            "thread_id": "thread-1",
            "evidence_summary": {
                "total": 2,
                "required_total": 1,
                "optional_total": 1,
                "failed_required": 1,
            },
            "failed_evidence_items": [
                {
                    "kind": "reference_url",
                    "source": "https://example.com/spec",
                    "required": True,
                    "status": "failed",
                    "purpose": "ground the source document",
                    "error": "crawl timeout",
                }
            ],
            "block_resolution_choices": ["retry", "remove_source"],
        }
    )

    payload = snapshot.model_dump()

    assert payload["evidence_summary"] == {
        "total": 2,
        "required_total": 1,
        "optional_total": 1,
        "failed_required": 1,
    }
    assert payload["failed_evidence_items"][0]["kind"] == "reference_url"
    assert payload["block_resolution_choices"] == ["retry", "remove_source"]


def test_creation_session_snapshot_supports_pending_blueprint_patch_and_audit_trail():
    snapshot = CreationSessionSnapshot.model_validate(
        {
            "session_id": "session-1",
            "thread_id": "thread-1",
            "blueprint": {
                "title": "Confirmed Blueprint",
                "sections": [
                    {
                        "id": "s1",
                        "title": "Overview",
                        "level": 2,
                        "word_budget": 400,
                        "must_cover": ["context"],
                        "assets": ["asset-1"],
                        "visuals": [
                            {
                                "type": "ai_image",
                                "description": "System overview",
                                "position": "before_section",
                            }
                        ],
                    }
                ],
                "total_word_budget": 400,
            },
            "pending_blueprint_patch": {
                "title": "Renamed Blueprint",
                "sections": [
                    {
                        "id": "s1",
                        "title": "Overview",
                        "level": 2,
                        "word_budget": 400,
                        "must_cover": ["context"],
                        "assets": ["asset-1"],
                        "visuals": [
                            {
                                "type": "ai_image",
                                "description": "System overview",
                                "position": "before_section",
                            }
                        ],
                    }
                ],
                "total_word_budget": 400,
            },
            "blueprint_change_audit": [
                {
                    "decision": "auto_patch",
                    "changes": ["section s1 must_cover updated"],
                }
            ],
        }
    )

    payload = snapshot.model_dump()

    assert payload["pending_blueprint_patch"]["title"] == "Renamed Blueprint"
    assert payload["blueprint_change_audit"][0]["decision"] == "auto_patch"
    assert payload["blueprint_change_audit"][0]["changes"] == ["section s1 must_cover updated"]


def test_creation_session_snapshot_includes_document_tree_and_draft_section_nodes():
    snapshot = CreationSessionSnapshot.model_validate(
        {
            "session_id": "session-1",
            "thread_id": "thread-1",
            "draft_sections": [
                {
                    "node_id": "section:intro",
                    "section_id": "intro",
                    "title": "Intro",
                    "level": 2,
                    "content": "Content",
                }
            ],
            "document_tree": {
                "root": {
                    "node_id": "document:title",
                    "title": "Doc",
                    "level": 1,
                    "content": "",
                },
                "sections": [
                    {
                        "node_id": "section:intro",
                        "section_id": "intro",
                        "title": "Intro",
                        "level": 2,
                        "content": "Content",
                    }
                ],
            },
        }
    )

    payload = snapshot.model_dump()

    assert payload["draft_sections"][0]["node_id"] == "section:intro"
    assert payload["document_tree"]["root"]["node_id"] == "document:title"
    assert payload["document_tree"]["sections"][0]["node_id"] == "section:intro"
