from app.main import build_initial_state
from app.schemas.request import AgentRunRequest


def test_request_accepts_evidence_items():
    req = AgentRunRequest(
        user_message="Use this source",
        evidence_items=[
            {
                "type": "reference_url",
                "required": True,
                "url": "https://example.com/spec",
            }
        ],
    )

    assert req.evidence_items[0].type == "reference_url"


def test_build_initial_state_seeds_normalized_evidence_items():
    req = AgentRunRequest(
        user_message="Use this source",
        evidence_items=[
            {
                "type": "reference_url",
                "required": True,
                "url": "https://example.com/spec",
            },
            {
                "type": "uploaded_document",
                "required": True,
                "missing": True,
            },
        ],
    )

    state = build_initial_state(req, task_id="task-1", thread_id="thread-1")

    assert state["evidence_items"] == [
        {
            "kind": "reference_url",
            "source": "https://example.com/spec",
            "required": True,
            "status": "pending",
            "missing": False,
            "error": None,
        },
        {
            "kind": "uploaded_document",
            "source": "uploaded_document",
            "required": True,
            "status": "failed",
            "missing": True,
            "error": "Required evidence was not provided.",
        },
    ]
