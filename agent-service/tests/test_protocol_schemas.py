from app.schemas.request import AgentResumeRequest
from app.schemas.response import AwaitInputEvent, CancelledEvent


def test_agent_resume_request_accepts_clarify_and_outline_payloads():
    clarify = AgentResumeRequest.model_validate(
        {
            "thread_id": "thread-1",
            "resume_value": {"answers": "Focus on rollback and retries."},
        }
    )
    outline = AgentResumeRequest.model_validate(
        {
            "thread_id": "thread-1",
            "resume_value": {
                "action": "confirm",
                "confirmed_outline": "## Overview\n## Workflow",
            },
        }
    )

    assert clarify.resume_value.answers == "Focus on rollback and retries."
    assert outline.resume_value.action == "confirm"


def test_agent_resume_request_accepts_brief_blueprint_and_review_payloads():
    brief = AgentResumeRequest.model_validate(
        {
            "thread_id": "thread-1",
            "resume_value": {
                "type": "brief",
                "brief": {"audience": "engineers"},
            },
        }
    )
    blueprint = AgentResumeRequest.model_validate(
        {
            "thread_id": "thread-1",
            "resume_value": {
                "type": "blueprint",
                "blueprint": {"title": "Doc", "sections": []},
            },
        }
    )
    review = AgentResumeRequest.model_validate(
        {
            "thread_id": "thread-1",
            "resume_value": {
                "type": "review",
                "selected_issue_ids": ["issue-1"],
                "feedback": "Tighten this section",
            },
        }
    )

    assert brief.resume_value.type == "brief"
    assert blueprint.resume_value.type == "blueprint"
    assert review.resume_value.type == "review"
    assert review.resume_value.selected_issue_ids == ["issue-1"]


def test_await_input_event_requires_typed_phase_payload_match():
    event = AwaitInputEvent.model_validate(
        {
            "type": "await_input",
            "phase": "propose",
            "data": {
                "type": "propose",
                "proposals": [
                    {"title": "Option A", "description": "Lean structure"},
                    {"title": "Option B", "description": "Evidence-first"},
                ],
            },
        }
    )

    assert event.phase == "propose"
    assert event.data.type == "propose"
    assert event.data.proposals[1].title == "Option B"


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


def test_outline_await_input_event_accepts_structured_artifact_plan():
    event = AwaitInputEvent.model_validate(
        {
            "type": "await_input",
            "phase": "outline",
            "data": {
                "type": "outline",
                "outline": "## Windows Installation\n## Verification",
                "artifact_plan": [
                    {
                        "section_id": "section-1",
                        "section_title": "Windows Installation",
                        "artifacts": ["code_block", "table"],
                    },
                    {
                        "section_id": "section-2",
                        "section_title": "Verification",
                        "artifacts": ["callout"],
                    },
                ],
            },
        }
    )

    assert event.phase == "outline"
    assert event.data.type == "outline"
    assert event.data.artifact_plan[0].section_title == "Windows Installation"
    assert event.data.artifact_plan[0].artifacts == ["code_block", "table"]


def test_cancelled_event_schema_exists():
    event = CancelledEvent.model_validate({"type": "cancelled"})

    assert event.type == "cancelled"
