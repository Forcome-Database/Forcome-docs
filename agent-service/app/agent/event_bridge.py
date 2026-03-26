"""PydanticAI 事件 → SSE 事件映射。

关键时序说明（E-01 修正）：
PydanticAI run_stream_events() 的事件顺序为：
  FunctionToolCallEvent → FunctionToolResultEvent  # 工具调用
  → PartStartEvent(text) → FinalResultEvent        # 模型开始最终回复
  → PartDeltaEvent × N                              # 内容流式输出（在 FinalResult 之后！）
  → PartEndEvent → AgentRunResultEvent              # 结束

FinalResultEvent 是"模型决定这是最终回复"的信号，不是"所有内容已发送"的信号。
done SSE 事件必须在 async for 循环完全结束后由 runner 发出，不在此处映射。
"""
from __future__ import annotations

from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    FinalResultEvent,
    TextPartDelta,
)

# 工具名 → 中文描述（前端展示用）
TOOL_DESCRIPTIONS: dict[str, str] = {
    "extract_document_tool": "正在提取文档内容...",
    "scrape_url_tool": "正在抓取网页内容...",
    "search_web_tool": "正在搜索相关信息...",
    "read_page_tool": "正在读取页面内容...",
}


def map_pydantic_event_to_sse(event: object) -> dict | None:
    """将 PydanticAI 事件转为 SSE 事件 dict。

    返回 None 表示该事件不需要发送给前端（静默跳过）。

    Args:
        event: PydanticAI 流式事件对象。

    Returns:
        SSE 事件 dict，或 None（跳过）。
    """
    # 工具调用开始
    if isinstance(event, FunctionToolCallEvent):
        tool_name = event.part.tool_name
        return {
            "type": "tool_call",
            "tool": tool_name,
            "description": TOOL_DESCRIPTIONS.get(tool_name, f"正在执行 {tool_name}..."),
            "args": {},
        }

    # 工具调用完成
    if isinstance(event, FunctionToolResultEvent):
        return {"type": "tool_result", "status": "success"}

    # Part 开始（检测 thinking part）
    if isinstance(event, PartStartEvent):
        part = event.part
        # thinking part：模型内部推理过程（pydantic-ai >= 1.72.0 ThinkingConfig 启用时）
        if hasattr(part, "part_kind") and part.part_kind == "thinking":
            return {"type": "thinking", "content": ""}
        return None  # 其他 part start（text/tool-call 等）静默跳过

    # 内容流式 delta
    if isinstance(event, PartDeltaEvent):
        if isinstance(event.delta, TextPartDelta):
            return {"type": "content", "chunk": event.delta.content_delta}
        # 工具参数 delta、thinking delta 等 → 静默跳过
        return None

    # FinalResultEvent：模型决定"这是最终回复"，但内容流尚未完成
    # 不映射为 done！done 由 runner.py 在循环结束后发出（E-01 修正）
    if isinstance(event, FinalResultEvent):
        return None

    # 未知事件类型 → 静默跳过
    return None
