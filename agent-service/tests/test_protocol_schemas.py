import pytest
from pydantic import ValidationError

from app.schemas.request import AgentResumeRequest
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


def test_agent_resume_request_rejects_legacy_resume_payloads():
    with pytest.raises(ValidationError):
        AgentResumeRequest.model_validate(
            {
                "thread_id": "thread-1",
                "resume_value": {"answers": "Focus on rollback and retries."},
            }
        )

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
                    "section_id": "intro",
                    "title": "Intro",
                    "level": 2,
                    "content": "Content",
                }
            ],
        }
    )

    assert event.markdown.startswith("# Title")
    assert event.sections[0].section_id == "intro"
    assert event.sections[0].content == "Content"
