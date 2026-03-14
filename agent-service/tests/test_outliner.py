import pytest

from app.agent.nodes import outliner


class _FakeResponse:
    def __init__(self, content: str):
        self.content = content


class _FakeModel:
    async def ainvoke(self, _messages):
        return _FakeResponse("## Quick Start\n\nUse the source structure.")


@pytest.mark.asyncio
async def test_outliner_interrupt_payload_includes_structured_artifact_plan(monkeypatch):
    captured_interrupt_payloads: list[dict] = []

    def fake_interrupt(payload: dict):
        captured_interrupt_payloads.append(payload)
        return {
            "action": "confirm",
            "confirmed_outline": payload["outline"],
        }

    async def fake_emit(_task_id: str, _event: dict):
        return None

    monkeypatch.setattr(outliner, "get_chat_model", lambda: _FakeModel())
    monkeypatch.setattr(outliner, "interrupt", fake_interrupt)
    monkeypatch.setattr(outliner, "emit", fake_emit)

    result = await outliner.outliner_node(
        {
            "_thread_id": "thread-1",
            "user_message": "Rewrite the quick start from the source document.",
            "document_strategy": {
                "requiredArtifacts": ["code_block", "table"],
            },
            "document_plan": {
                "sections": [
                    {
                        "id": "section-1",
                        "title": "Windows Installation",
                        "goal": "Keep the exact download and install steps.",
                        "artifacts": ["code_block", "table"],
                        "must_cover": ["download link"],
                        "evidence": ["web_crawl"],
                    },
                    {
                        "id": "section-2",
                        "title": "Verification",
                        "goal": "Explain how to confirm the service is running.",
                        "artifacts": ["callout"],
                        "must_cover": ["running status"],
                        "evidence": ["web_crawl"],
                    },
                ]
            },
        }
    )

    assert result["phase"] == "writer"
    assert len(captured_interrupt_payloads) == 1
    assert captured_interrupt_payloads[0] == {
        "type": "outline",
        "outline": "## Quick Start\n\nUse the source structure.",
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
    }
