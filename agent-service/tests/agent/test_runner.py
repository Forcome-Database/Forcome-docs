"""测试 Agent Runner 的事件流行为。"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.agent.runner import run_agent
from app.agent.deps import AgentDeps


@pytest.fixture
def deps():
    return AgentDeps(
        thread_id="t1", page_id="p1", workspace_id="ws1", user_id="u1",
        docmost_base_url="http://localhost:3000", internal_secret="secret",
    )


async def collect_events(gen):
    """收集 async generator 的所有事件。"""
    events = []
    async for e in gen:
        events.append(e)
    return events


@pytest.mark.asyncio
async def test_yields_done_event(deps):
    """Runner 必须产出 done 事件。"""
    async def mock_stream(*args, **kwargs):
        # 空迭代
        return
        yield  # 使其成为 async generator

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test prompt", deps))

    assert any(e["type"] == "done" for e in events)


@pytest.mark.asyncio
async def test_yields_error_on_exception(deps):
    """Agent 抛异常时 → error 事件。"""
    async def mock_stream(*args, **kwargs):
        raise RuntimeError("LLM error")
        yield  # 使其成为 async generator

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test", deps))

    assert any(e["type"] == "error" for e in events)
    # 出错时不发 done
    assert not any(e["type"] == "done" for e in events)


@pytest.mark.asyncio
async def test_content_accumulated(deps):
    """content 事件的 chunk 应被正确产出并累积。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    async def mock_stream(*args, **kwargs):
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="Hello "))
        yield PartDeltaEvent(index=1, delta=TextPartDelta(content_delta="World"))

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test", deps))

    content_events = [e for e in events if e.get("type") == "content"]
    assert len(content_events) == 2
    content = "".join(e["chunk"] for e in content_events)
    assert content == "Hello World"
    assert any(e["type"] == "done" for e in events)


@pytest.mark.asyncio
async def test_cancelled_stops_stream(deps):
    """取消时产出 cancelled 事件并停止。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta
    from app.agent.cancellation import register_task, cancel_task, unregister_task

    # 注册并立即取消
    register_task("task-1", deps.thread_id)
    cancel_task("task-1")

    async def mock_stream(*args, **kwargs):
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="content"))

    try:
        with patch("app.agent.runner.get_agent") as mock_get:
            mock_agent = MagicMock()
            mock_agent.run_stream_events = mock_stream
            mock_get.return_value = mock_agent

            events = await collect_events(run_agent("test", deps))

        assert any(e["type"] == "cancelled" for e in events)
        # 取消后不发 done
        assert not any(e["type"] == "done" for e in events)
    finally:
        unregister_task("task-1", deps.thread_id)


@pytest.mark.asyncio
async def test_thinking_phases_tracked(deps):
    """多阶段思考事件应携带递增的 phase 字段。"""
    from pydantic_ai.messages import (
        PartStartEvent, PartDeltaEvent, ThinkingPart, ThinkingPartDelta,
        FunctionToolCallEvent, FunctionToolResultEvent, ToolCallPart, ToolReturnPart,
        TextPartDelta, FinalResultEvent,
    )

    async def mock_stream(*args, **kwargs):
        # Phase 1: thinking before tool call
        yield PartStartEvent(index=0, part=ThinkingPart(content=""))
        yield PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="Planning..."))
        # Tool call
        yield FunctionToolCallEvent(part=ToolCallPart(tool_name="search_web_tool", args={}, tool_call_id="c1"))
        yield FunctionToolResultEvent(result=ToolReturnPart(tool_name="search_web_tool", content="ok", tool_call_id="c1"))
        # Phase 2: thinking after tool result
        yield PartStartEvent(index=1, part=ThinkingPart(content=""))
        yield PartDeltaEvent(index=1, delta=ThinkingPartDelta(content_delta="Analyzing..."))
        # Final output
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=2, delta=TextPartDelta(content_delta="Result"))

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test", deps))

    thinking_events = [e for e in events if e.get("type") == "thinking"]
    assert len(thinking_events) == 4  # 2 PartStart + 2 delta

    # Phase 1 events
    assert thinking_events[0]["phase"] == 1
    assert thinking_events[0]["content"] == ""  # PartStartEvent marker
    assert thinking_events[1]["phase"] == 1
    assert thinking_events[1]["chunk"] == "Planning..."

    # Phase 2 events
    assert thinking_events[2]["phase"] == 2
    assert thinking_events[2]["content"] == ""  # PartStartEvent marker
    assert thinking_events[3]["phase"] == 2
    assert thinking_events[3]["chunk"] == "Analyzing..."


@pytest.mark.asyncio
async def test_warning_on_missing_image(deps):
    """图片 URL 缺失时产出 warning 事件。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    deps.uploaded_image_urls = {"img1": "http://example.com/missing.jpg"}

    async def mock_stream(*args, **kwargs):
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="No images here " * 20))

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test", deps))

    assert any(e.get("type") == "warning" for e in events)
    assert any(e["type"] == "done" for e in events)
