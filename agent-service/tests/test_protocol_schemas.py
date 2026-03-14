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
