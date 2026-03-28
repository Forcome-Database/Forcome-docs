"""测试 PydanticAI 事件 → SSE 事件桥接器。"""
import pytest
from app.agent.event_bridge import map_pydantic_event_to_sse


def test_tool_call_mapping():
    """FunctionToolCallEvent → tool_call SSE 事件。"""
    from pydantic_ai.messages import FunctionToolCallEvent, ToolCallPart
    part = ToolCallPart(tool_name="extract_document_tool", args={}, tool_call_id="c1")
    event = FunctionToolCallEvent(part=part)
    sse = map_pydantic_event_to_sse(event)
    assert sse is not None
    assert sse["type"] == "tool_call"
    assert sse["tool"] == "extract_document_tool"
    assert "提取" in sse["description"]


def test_tool_call_unknown_tool():
    """未知工具也应返回 tool_call，使用默认描述。"""
    from pydantic_ai.messages import FunctionToolCallEvent, ToolCallPart
    part = ToolCallPart(tool_name="my_custom_tool", args={}, tool_call_id="c2")
    event = FunctionToolCallEvent(part=part)
    sse = map_pydantic_event_to_sse(event)
    assert sse is not None
    assert sse["type"] == "tool_call"
    assert "my_custom_tool" in sse["description"]


def test_tool_result_mapping():
    """FunctionToolResultEvent → tool_result SSE 事件。"""
    from pydantic_ai.messages import FunctionToolResultEvent, ToolReturnPart
    part = ToolReturnPart(tool_name="extract_document_tool", content="done", tool_call_id="c1")
    event = FunctionToolResultEvent(result=part)
    sse = map_pydantic_event_to_sse(event)
    assert sse is not None
    assert sse["type"] == "tool_result"


def test_text_delta_mapping():
    """PartDeltaEvent + TextPartDelta → content SSE 事件。"""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta
    event = PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="Hello 你好"))
    sse = map_pydantic_event_to_sse(event)
    assert sse is not None
    assert sse["type"] == "content"
    assert sse["chunk"] == "Hello 你好"


def test_non_text_delta_skipped():
    """非文本 delta（如工具参数 delta）→ None（静默跳过）。"""
    from pydantic_ai.messages import PartDeltaEvent, ToolCallPartDelta
    event = PartDeltaEvent(index=0, delta=ToolCallPartDelta(args_delta='{"key": "val"}'))
    sse = map_pydantic_event_to_sse(event)
    assert sse is None


def test_final_result_returns_none():
    """FinalResultEvent → None（E-01 修正：不在此处发 done）。

    FinalResultEvent 在内容流完成前触发，done 事件由 runner.py 在循环结束后发出。
    """
    from pydantic_ai.messages import FinalResultEvent
    # FinalResultEvent 构造需要 tool_name 和 tool_call_id
    event = FinalResultEvent(tool_name=None, tool_call_id=None)
    sse = map_pydantic_event_to_sse(event)
    assert sse is None


def test_unknown_event_returns_none():
    """未知事件类型 → None（静默跳过，不抛异常）。"""
    class UnknownEvent:
        pass
    sse = map_pydantic_event_to_sse(UnknownEvent())
    assert sse is None


def test_all_tool_descriptions_present():
    """所有预定义工具都应有中文描述。"""
    from app.agent.event_bridge import TOOL_DESCRIPTIONS
    assert "extract_document_tool" in TOOL_DESCRIPTIONS
    assert "scrape_url_tool" in TOOL_DESCRIPTIONS
    assert "search_web_tool" in TOOL_DESCRIPTIONS
    assert "read_page_tool" in TOOL_DESCRIPTIONS
    for desc in TOOL_DESCRIPTIONS.values():
        assert len(desc) > 0


def test_part_start_thinking_detection():
    """PartStartEvent with thinking part 应返回 thinking SSE 事件。"""
    from pydantic_ai.messages import PartStartEvent, ThinkingPart
    # ThinkingPart 是 thinking 类型的 ModelResponsePart
    part = ThinkingPart(content="Let me think...")
    event = PartStartEvent(index=0, part=part)
    sse = map_pydantic_event_to_sse(event)
    assert sse is not None
    assert sse["type"] == "thinking"
    assert sse["content"] == ""


def test_part_start_text_skipped():
    """PartStartEvent with TextPart 应返回 None（静默跳过）。"""
    from pydantic_ai.messages import PartStartEvent, TextPart
    # TextPart 是文本回复的开始
    part = TextPart(content="")
    event = PartStartEvent(index=0, part=part)
    sse = map_pydantic_event_to_sse(event)
    assert sse is None
