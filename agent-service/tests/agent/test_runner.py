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
    """content 事件的 chunk 应被正确产出。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta

    async def mock_stream(*args, **kwargs):
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
async def test_warning_on_missing_image(deps):
    """图片 URL 缺失时产出 warning 事件。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta

    deps.uploaded_image_urls = {"img1": "http://example.com/missing.jpg"}

    async def mock_stream(*args, **kwargs):
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="No images here " * 20))

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test", deps))

    assert any(e.get("type") == "warning" for e in events)
    assert any(e["type"] == "done" for e in events)
