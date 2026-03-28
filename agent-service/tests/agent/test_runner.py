"""测试 Agent Runner 的事件流行为。"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.agent.runner import run_agent
from app.agent.deps import AgentDeps


# Common patch target — get_agent is now imported inside the function body
_PATCH_GET_AGENT = "app.agent.agent.get_agent"
# select_skill is also imported inside the function body
_PATCH_SELECT_SKILL = "app.agent.skill_router.select_skill"


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

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
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

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
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

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
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
        with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
             patch(_PATCH_GET_AGENT) as mock_get:
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

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
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

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test", deps))

    assert any(e.get("type") == "warning" for e in events)
    assert any(e["type"] == "done" for e in events)


@pytest.mark.asyncio
async def test_done_event_includes_output_type(deps):
    """done 事件应包含 output_type 字段。"""
    async def mock_stream(*args, **kwargs):
        return
        yield

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("test prompt", deps))

    done_events = [e for e in events if e["type"] == "done"]
    assert len(done_events) == 1
    assert "output_type" in done_events[0]


@pytest.mark.asyncio
async def test_short_output_classified_as_conversation(deps):
    """短回复（无工具、无文件、无 markdown）应被分类为 conversation。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    async def mock_stream(*args, **kwargs):
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="Sure, I can help!"))

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("hello", deps))

    done = next(e for e in events if e["type"] == "done")
    assert done["output_type"] == "conversation"


@pytest.mark.asyncio
async def test_long_output_classified_as_document(deps):
    """长回复应被分类为 document。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    long_text = "# Report\n\n" + "This is detailed content. " * 50

    async def mock_stream(*args, **kwargs):
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta=long_text))

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("write a report", deps))

    done = next(e for e in events if e["type"] == "done")
    assert done["output_type"] == "document"


@pytest.mark.asyncio
async def test_conversation_output_skips_validation(deps):
    """conversation 类型的输出应跳过验证，不产生 warning。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    async def mock_stream(*args, **kwargs):
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="OK!"))

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("hi", deps))

    # No warnings for conversational output
    assert not any(e.get("type") == "warning" for e in events)
    done = next(e for e in events if e["type"] == "done")
    assert done["output_type"] == "conversation"


@pytest.mark.asyncio
async def test_skill_routing_with_message_history(deps):
    """有对话历史且无文件时应选择 editing skill。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    mock_store = AsyncMock()
    mock_store.load = AsyncMock(return_value=["fake_message"])
    deps.session_store = mock_store

    async def mock_stream(*args, **kwargs):
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="# Edited doc"))

    with patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("update the intro", deps))

    # select_skill is NOT mocked — it runs for real
    # With message_history and no files → should call get_agent(skill="editing")
    mock_get.assert_called_once_with(skill="editing")


@pytest.mark.asyncio
async def test_page_content_injected_in_editing_mode(deps):
    """editing 模式下，page_content 应被注入到 prompt 中。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    mock_store = AsyncMock()
    mock_store.load = AsyncMock(return_value=["fake_message"])
    deps.session_store = mock_store
    deps.page_content = "Existing page text here"

    captured_prompts = []

    async def mock_stream(prompt, **kwargs):
        captured_prompts.append(prompt)
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="Updated"))

    with patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("fix typos", deps))

    assert len(captured_prompts) == 1
    assert "[CURRENT DOCUMENT]" in captured_prompts[0]
    assert "Existing page text here" in captured_prompts[0]


@pytest.mark.asyncio
async def test_conversation_save_uses_all_messages(deps):
    """对话保存应使用 all_messages_snapshot 而非简单文本。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta
    from pydantic_ai import AgentRunResultEvent

    mock_store = AsyncMock()
    mock_store.load = AsyncMock(return_value=None)
    mock_store.save = AsyncMock()
    deps.session_store = mock_store

    fake_messages = ["msg1", "msg2"]

    async def mock_stream(*args, **kwargs):
        # Simulate AgentRunResultEvent with all_messages
        mock_result = MagicMock()
        mock_result.output = "# Document output"
        mock_result.all_messages = MagicMock(return_value=fake_messages)
        mock_result.response = None
        yield AgentRunResultEvent(result=mock_result)
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="# Document output"))

    with patch(_PATCH_SELECT_SKILL, return_value="creation"), \
         patch(_PATCH_GET_AGENT) as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = await collect_events(run_agent("write something", deps))

    # Verify save was called with all_messages
    mock_store.save.assert_called_once_with(
        thread_id="t1",
        user_id="u1",
        messages=fake_messages,
    )
