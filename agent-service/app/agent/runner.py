"""Agent 执行引擎 — 连接 Agent、SSE、会话管理。

事件顺序（E-01 修正）：
  run_stream_events() 会在所有内容流完成后以 AgentRunResultEvent 结束。
  done 事件必须在 async for 循环完全退出后由此模块发出，不在 FinalResultEvent 时发出。
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from pydantic_ai import AgentRunResultEvent
from pydantic_ai.messages import FunctionToolCallEvent

from app.agent.agent import get_agent
from app.agent.deps import AgentDeps
from app.agent.event_bridge import map_pydantic_event_to_sse
from app.agent.validator import validate_agent_output
from app.agent.cancellation import is_task_cancelled

# 单次 run 最大工具调用次数。
# PydanticAI 无内置 max_tool_calls 参数，此处作为生产级安全阀：
# 防止 Agent 在工具失败时无限循环调用。
MAX_TOOL_CALLS = 10

logger = logging.getLogger(__name__)


async def run_agent(
    user_message: str,
    deps: AgentDeps,
    *,
    multimodal_parts: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """执行 Agent 并产出 SSE 事件流。

    Args:
        user_message: 用户输入文本。
        deps: 每次调用的运行时依赖（thread_id、session_store 等）。
        multimodal_parts: 额外的多模态内容（BinaryContent 等），可选。

    Yields:
        SSE 事件 dict，类型包括：
          - content: 流式文本 chunk
          - tool_call / tool_result: 工具调用
          - thinking: 模型内部推理（若启用）
          - warning: 后验证警告
          - error: 执行异常
          - cancelled: 任务已取消
          - done: 所有内容流完成（E-01：在循环结束后发出）
    """
    agent = get_agent()

    # 1. 加载对话历史
    message_history = None
    if deps.session_store:
        try:
            message_history = await deps.session_store.load_messages(deps.thread_id)
        except Exception as e:
            logger.warning("Failed to load message history for thread %s: %s", deps.thread_id, e)

    # 2. 构建 prompt（文本 + multimodal）
    if multimodal_parts:
        prompt: Any = [user_message, *multimodal_parts]
    else:
        prompt = user_message

    # 3. 流式执行 Agent
    streamed_chunks: list[str] = []  # 流式 chunk 累积（回退用）
    authoritative_output: str | None = None  # AgentRunResultEvent 权威输出
    tool_call_count = 0  # 工具调用计数器（安全阀）
    thinking_phase = 0  # 思考阶段计数器（多阶段可见性）
    try:
        stream_kwargs: dict[str, Any] = {"deps": deps}
        if message_history:
            stream_kwargs["message_history"] = message_history

        async for event in agent.run_stream_events(prompt, **stream_kwargs):
            # 取消检查（每事件间检查一次）
            if is_task_cancelled(None, deps.thread_id):
                yield {"type": "cancelled"}
                return

            # 工具调用计数 — 超过上限则强制停止，防止无限循环
            if isinstance(event, FunctionToolCallEvent):
                tool_call_count += 1
                if tool_call_count > MAX_TOOL_CALLS:
                    logger.error(
                        "Max tool calls (%d) exceeded for thread %s — stopping agent loop",
                        MAX_TOOL_CALLS,
                        deps.thread_id,
                    )
                    yield {
                        "type": "error",
                        "message": f"工具调用次数超过上限（{MAX_TOOL_CALLS} 次），请尝试简化请求或换一种方式描述任务。",
                    }
                    return

            # AgentRunResultEvent 包含权威的最终输出
            if isinstance(event, AgentRunResultEvent):
                if hasattr(event.result, "output"):
                    authoritative_output = event.result.output
                # Gemini truncation detection: MAX_TOKENS → PydanticAI 'length'
                try:
                    resp = getattr(event.result, "response", None)
                    if resp and getattr(resp, "finish_reason", None) == "length":
                        yield {
                            "type": "warning",
                            "issues": ["输出可能不完整：已达到模型 token 上限，内容可能被截断。"],
                        }
                except Exception:
                    pass
                continue

            # 将 PydanticAI 事件转换为 SSE dict
            sse = map_pydantic_event_to_sse(event)
            if sse is None:
                continue

            # 追踪思考阶段 — 每个 PartStartEvent(ThinkingPart) 开启新阶段
            if sse["type"] == "thinking":
                if sse.get("content") == "":  # PartStartEvent 标记
                    thinking_phase += 1
                sse["phase"] = thinking_phase

            # 累积 content chunk（仅作为 AgentRunResultEvent 缺失时的回退）
            if sse["type"] == "content":
                streamed_chunks.append(sse.get("chunk", ""))

            yield sse

    except Exception as e:
        logger.exception("Agent execution failed for thread %s", deps.thread_id)
        yield {"type": "error", "message": str(e)}
        return

    # 选择最终输出：AgentRunResultEvent 优先，流式 chunks 回退
    final_output = authoritative_output if authoritative_output is not None else "".join(streamed_chunks)

    # 4. 后验证（在循环结束后，使用最终完整输出）
    validation = None
    if final_output:
        try:
            validation = validate_agent_output(
                final_output,
                deps.uploaded_image_urls,
                source_word_count=getattr(deps, "source_word_count", 0),
            )
            if not validation.passed:
                logger.warning(
                    "Validation issues for thread %s (score=%.2f): %s",
                    deps.thread_id, validation.score, validation.issues,
                )
                yield {"type": "warning", "issues": validation.issues, "score": validation.score}
        except Exception as e:
            logger.warning("Post-validation failed for thread %s: %s", deps.thread_id, e)

    # 5. 发出 done 事件（E-01：在所有内容流完成后，循环退出后发出）
    yield {"type": "done"}

    # 6. 保存对话历史
    if deps.session_store and final_output:
        try:
            await deps.session_store.save_turn(
                thread_id=deps.thread_id,
                user_message=user_message,
                assistant_output=final_output,
            )
        except Exception as e:
            logger.warning("Failed to save conversation history for thread %s: %s", deps.thread_id, e)
