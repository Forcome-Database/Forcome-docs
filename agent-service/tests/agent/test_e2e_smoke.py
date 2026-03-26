"""E2E 冒烟测试（需要运行中的 LLM）。

运行方式:
  pytest -m e2e tests/agent/test_e2e_smoke.py -v     # 运行 E2E
  pytest -m "not e2e" tests/                          # 跳过 E2E
"""
import pytest

pytestmark = pytest.mark.e2e


@pytest.mark.asyncio
async def test_text_only_request():
    """纯文本指令，Agent 应直接生成内容不调工具。"""
    from app.agent.agent import create_agent, reset_agent
    from app.agent.runner import run_agent
    from app.agent.deps import AgentDeps

    reset_agent()
    deps = AgentDeps(
        thread_id="e2e-1",
        page_id=None,
        workspace_id="ws",
        user_id="u",
        docmost_base_url="http://localhost:3000",
        internal_secret="test",
    )

    events = []
    async for e in run_agent("写一段关于 Python 的简短介绍（100字以内）", deps):
        events.append(e)

    content = "".join(e.get("chunk", "") for e in events if e.get("type") == "content")
    assert len(content) > 20, f"Content too short: {len(content)} chars"
    assert any(e["type"] == "done" for e in events)
    tool_calls = [e for e in events if e.get("type") == "tool_call"]
    assert len(tool_calls) == 0, "Pure text request should not trigger tools"
    reset_agent()


@pytest.mark.asyncio
async def test_stream_event_types():
    """验证事件流包含正确的事件类型序列。"""
    from app.agent.agent import create_agent, reset_agent
    from app.agent.runner import run_agent
    from app.agent.deps import AgentDeps

    reset_agent()
    deps = AgentDeps(
        thread_id="e2e-2",
        page_id=None,
        workspace_id="ws",
        user_id="u",
        docmost_base_url="http://localhost:3000",
        internal_secret="test",
    )

    events = []
    async for e in run_agent("简单说一句话", deps):
        events.append(e)

    event_types = [e["type"] for e in events]
    assert "done" in event_types, "Must have done event"
    assert "content" in event_types or "error" in event_types, "Must have content or error"
    reset_agent()
