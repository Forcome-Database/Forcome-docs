import base64
import json

import pytest

from app.agent.nodes.evidence_acquirer import evidence_acquirer_node
from app.agent.nodes.evidence_gate import evidence_gate_node
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


class FakeTool:
    def __init__(self, result: str):
        self.result = result
        self.calls: list[dict] = []

    async def ainvoke(self, payload: dict) -> str:
        self.calls.append(payload)
        return self.result


@pytest.mark.asyncio
async def test_reference_url_is_read_before_generation(monkeypatch):
    crawl_tool = FakeTool("# Reference content")
    monkeypatch.setattr(
        "app.agent.nodes.evidence_acquirer.get_tool",
        lambda name: crawl_tool if name == "firecrawl_scrape" else None,
    )

    result = await evidence_acquirer_node(
        {
            "user_message": "Rewrite based on the reference URL.",
            "uploaded_files": [],
            "research_results": [],
            "parsed_files": [],
            "generated_images": [],
            "evidence_items": [
                {
                    "kind": "reference_url",
                    "source": "https://example.com/spec",
                    "required": True,
                    "status": "pending",
                    "missing": False,
                    "error": None,
                }
            ],
            "_task_id": "task-1",
            "_thread_id": "thread-1",
        }
    )

    assert crawl_tool.calls == [{"url": "https://example.com/spec"}]
    assert result["research_results"] == [
        {
            "source": "reference_url",
            "url": "https://example.com/spec",
            "content": "# Reference content",
        }
    ]
    assert result["evidence_items"][0]["status"] == "success"


@pytest.mark.asyncio
async def test_uploaded_document_is_parsed_before_generation(monkeypatch):
    parser_tool = FakeTool(json.dumps({"text": "[Document]\n\nParsed content", "images": []}))
    monkeypatch.setattr(
        "app.agent.nodes.evidence_acquirer.get_tool",
        lambda name: parser_tool if name == "docling_parser" else None,
    )

    result = await evidence_acquirer_node(
        {
            "user_message": "Summarize the uploaded PDF.",
            "uploaded_files": [
                {
                    "filename": "spec.pdf",
                    "mimetype": "application/pdf",
                    "content_b64": base64.b64encode(b"pdf").decode(),
                }
            ],
            "research_results": [],
            "parsed_files": [],
            "generated_images": [],
            "evidence_items": [
                {
                    "kind": "uploaded_document",
                    "source": "spec.pdf",
                    "required": True,
                    "status": "pending",
                    "missing": False,
                    "error": None,
                }
            ],
            "_task_id": "task-1",
            "_thread_id": "thread-1",
        }
    )

    assert parser_tool.calls == [
        {
            "file_content_b64": base64.b64encode(b"pdf").decode(),
            "filename": "spec.pdf",
            "mimetype": "application/pdf",
        }
    ]
    assert result["parsed_files"] == [
        {
            "filename": "spec.pdf",
            "content": "[Document]\n\nParsed content",
            "image_urls": [],
        }
    ]
    assert result["evidence_items"][0]["status"] == "success"


@pytest.mark.asyncio
async def test_uploaded_image_is_understood_before_generation(monkeypatch):
    vision_tool = FakeTool("Screenshot shows a failed deployment banner.")
    monkeypatch.setattr(
        "app.agent.nodes.evidence_acquirer.get_tool",
        lambda name: vision_tool if name == "vlm_understand" else None,
    )

    result = await evidence_acquirer_node(
        {
            "user_message": "Explain the uploaded screenshot.",
            "uploaded_files": [
                {
                    "filename": "error.png",
                    "mimetype": "image/png",
                    "content_b64": base64.b64encode(b"png").decode(),
                }
            ],
            "research_results": [],
            "parsed_files": [],
            "generated_images": [],
            "evidence_items": [
                {
                    "kind": "uploaded_image",
                    "source": "error.png",
                    "required": True,
                    "status": "pending",
                    "missing": False,
                    "error": None,
                }
            ],
            "_task_id": "task-1",
            "_thread_id": "thread-1",
        }
    )

    assert vision_tool.calls == [
        {
            "image_b64": base64.b64encode(b"png").decode(),
            "question": "Explain the uploaded screenshot.",
        }
    ]
    assert result["research_results"] == [
        {
            "source": "uploaded_image",
            "filename": "error.png",
            "content": "Screenshot shows a failed deployment banner.",
        }
    ]
    assert result["evidence_items"][0]["status"] == "success"


@pytest.mark.asyncio
async def test_required_evidence_failure_blocks_before_write():
    result = await evidence_gate_node(
        {
            "evidence_items": [
                {
                    "kind": "reference_url",
                    "source": "https://example.com/spec",
                    "required": True,
                    "status": "success",
                    "missing": False,
                    "error": None,
                },
                {
                    "kind": "web_search",
                    "source": "web_search",
                    "required": True,
                    "status": "failed",
                    "missing": False,
                    "error": "fetch failed",
                },
            ],
            "_task_id": "task-1",
            "_thread_id": "thread-1",
        }
    )

    assert result["phase"] == "blocked"
    assert "web_search" in result["blocked_reason"]
    assert "fetch failed" in result["blocked_reason"]


@pytest.mark.asyncio
async def test_required_evidence_timeout_blocks_before_write():
    result = await evidence_gate_node(
        {
            "evidence_items": [
                {
                    "kind": "reference_url",
                    "source": "https://example.com/spec",
                    "required": True,
                    "status": "failed",
                    "missing": False,
                    "error": "timed out while reading the URL",
                }
            ],
            "_task_id": "task-1",
            "_thread_id": "thread-1",
        }
    )

    assert result["phase"] == "blocked"
    assert "timed out" in result["blocked_reason"]
