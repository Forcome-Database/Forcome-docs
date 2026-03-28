"""Agent 执行引擎 — 连接 Agent、SSE、会话管理。

事件顺序（E-01 修正）：
  run_stream_events() 会在所有内容流完成后以 AgentRunResultEvent 结束。
  done 事件必须在 async for 循环完全退出后由此模块发出，不在 FinalResultEvent 时发出。
"""
from __future__ import annotations

import logging
import os
from typing import Any, AsyncIterator

from pydantic_ai import AgentRunResultEvent
from pydantic_ai.messages import FunctionToolCallEvent

from app.agent.deps import AgentDeps
from app.agent.event_bridge import map_pydantic_event_to_sse
from app.agent.validator import validate_agent_output
from app.agent.cancellation import is_task_cancelled

# 单次 run 最大工具调用次数。
# PydanticAI 无内置 max_tool_calls 参数，此处作为生产级安全阀：
# 防止 Agent 在工具失败时无限循环调用。
MAX_TOOL_CALLS = int(os.environ.get("AGENT_MAX_TOOL_CALLS", "10"))

logger = logging.getLogger(__name__)

_DOC_START = "<document>"
_DOC_END = "</document>"


def extract_document_content(output: str) -> str:
    """Extract content between <document> markers if present.

    Used in editing mode to separate document content from conversational text.
    If markers are absent, returns the original output unchanged (graceful fallback).
    """
    start = output.find(_DOC_START)
    end = output.rfind(_DOC_END)
    if start != -1 and end != -1 and end > start:
        return output[start + len(_DOC_START):end].strip()
    return output


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
    # 1. 加载对话历史
    message_history = None
    if deps.session_store:
        try:
            message_history = await deps.session_store.load(
                thread_id=deps.thread_id, user_id=deps.user_id
            )
        except Exception as e:
            logger.warning("Failed to load conversation for thread %s: %s", deps.thread_id, e)

    # 2. 构建 prompt（文本 + multimodal）
    if multimodal_parts:
        prompt: Any = [user_message, *multimodal_parts]
    else:
        prompt = user_message

    # Select skill based on context
    from app.agent.skill_router import select_skill
    from app.agent.agent import get_agent
    skill = select_skill(
        has_message_history=message_history is not None and len(message_history) > 0,
        has_files=len(deps.files) > 0,
        has_selection=deps.selection is not None and deps.selection.edit_mode in ("replace", "insert"),
    )
    agent = get_agent(skill=skill)

    # Inject context based on edit mode
    PAGE_CONTENT_LIMIT = 20_000
    edit_mode = "full"

    if deps.selection and deps.selection.edit_mode in ("replace", "insert"):
        # Selection mode: provide targeted context
        edit_mode = deps.selection.edit_mode
        parts = []
        if deps.selection.document_outline:
            parts.append(f"[DOCUMENT OUTLINE]\n{deps.selection.document_outline}\n[/DOCUMENT OUTLINE]")
        if deps.selection.context_before:
            parts.append(f"[CONTEXT BEFORE]\n{deps.selection.context_before}\n[/CONTEXT BEFORE]")
        if deps.selection.edit_mode == "replace" and deps.selection.selected_text:
            parts.append(f"[SELECTED TEXT]\n{deps.selection.selected_text}\n[/SELECTED TEXT]")
        elif deps.selection.edit_mode == "insert":
            parts.append("[CURSOR POSITION — insert content here]")
        if deps.selection.context_after:
            parts.append(f"[CONTEXT AFTER]\n{deps.selection.context_after}\n[/CONTEXT AFTER]")
        parts.append(f"User request: {user_message}")
        if multimodal_parts:
            prompt = ["\n\n".join(parts), *multimodal_parts]
        else:
            prompt = "\n\n".join(parts)
    elif skill == "editing" and deps.page_content:
        edit_mode = "full"
        page_text = deps.page_content[:PAGE_CONTENT_LIMIT]
        truncated_note = "\n[Document truncated]" if len(deps.page_content) > PAGE_CONTENT_LIMIT else ""
        if multimodal_parts:
            prompt = [f"[CURRENT DOCUMENT]\n{page_text}{truncated_note}\n[/CURRENT DOCUMENT]\n\n{user_message}", *multimodal_parts]
        else:
            prompt = f"[CURRENT DOCUMENT]\n{page_text}{truncated_note}\n[/CURRENT DOCUMENT]\n\n{user_message}"
    elif skill == "editing" and deps.page_id:
        edit_mode = "full"
        from app.agent.tools.read_page import read_page_impl
        try:
            page_data = await read_page_impl(deps.page_id)
            if page_data.get("status") == "success":
                page_content = page_data["content"]
                if multimodal_parts:
                    prompt = [f"[CURRENT DOCUMENT]\n{page_content}\n[/CURRENT DOCUMENT]\n\n{user_message}", *multimodal_parts]
                else:
                    prompt = f"[CURRENT DOCUMENT]\n{page_content}\n[/CURRENT DOCUMENT]\n\n{user_message}"
        except Exception as e:
            logger.warning("Failed to read page for editing fallback, thread %s: %s", deps.thread_id, e)
            yield {"type": "warning", "issues": ["无法读取当前页面内容作为编辑参考"]}

    # 3. 流式执行 Agent
    # 流式 chunk 累积——仅作为 AgentRunResultEvent 缺失时的回退。
    # 注意：streamed_chunks 包含所有轮次的文本（含中间叙述），
    # 而 authoritative_output 是 PydanticAI 验证后的纯最终轮输出。
    streamed_chunks: list[str] = []
    # AgentRunResultEvent 提供的权威输出（若存在），不含中间轮叙述文本。
    # 前端通过 done.final_content 接收此值，用于 "Apply to page"。
    authoritative_output: str | None = None
    tool_call_count = 0  # 工具调用计数器（安全阀）
    thinking_phase = 0  # 思考阶段计数器（多阶段可见性）
    all_messages_snapshot = None  # 捕获完整消息历史用于对话持久化
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
                # Capture full message history for conversation persistence
                if hasattr(event.result, "all_messages"):
                    all_messages_snapshot = event.result.all_messages()
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

            # 追踪思考阶段——PydanticAI 多轮工具调用中，每轮可能触发新的
            # ThinkingPart。PartStartEvent 以 content="" 空标记开始新阶段，
            # 后续的 ThinkingPartDelta 带实际内容。phase 字段帮助前端将
            # 多阶段思考分别展示为"思考 1"、"思考 2"等可折叠块。
            if sse["type"] == "thinking":
                if sse.get("content") == "":  # PartStartEvent 标记
                    thinking_phase += 1
                sse["phase"] = thinking_phase

            # 累积 content chunk（作为 AgentRunResultEvent 缺失时的回退）
            if sse["type"] == "content":
                streamed_chunks.append(sse.get("chunk", ""))

            yield sse

    except Exception as e:
        logger.exception("Agent execution failed for thread %s", deps.thread_id)
        yield {"type": "error", "message": str(e)}
        return

    # 选择最终输出：AgentRunResultEvent 优先，流式 chunks 回退
    final_output = authoritative_output if authoritative_output is not None else "".join(streamed_chunks)

    # 4. Output classification
    has_markdown_structure = any(
        marker in final_output for marker in ["# ", "## ", "| ", ":::"]
    ) if final_output else False

    output_type = "document"
    if (
        final_output
        and tool_call_count == 0
        and deps.source_word_count == 0
        and not deps.uploaded_image_urls
        and len(final_output.strip()) < 200
        and not has_markdown_structure
        and not deps.page_content
        and edit_mode == "full"  # Selection/insert output is always "document"
    ):
        output_type = "conversation"

    # Conditional validation — skip for conversational output
    validation = None
    if output_type == "document" and final_output:
        try:
            validation = validate_agent_output(
                final_output,
                deps.uploaded_image_urls,
                source_word_count=deps.source_word_count,
            )
            if not validation.passed:
                logger.warning(
                    "Validation issues for thread %s (score=%.2f): %s",
                    deps.thread_id, validation.score, validation.issues,
                )
                yield {"type": "warning", "issues": validation.issues, "score": validation.score}
        except Exception as e:
            logger.warning("Post-validation failed for thread %s: %s", deps.thread_id, e)

    # Quality retry for critical failures (score < 0.4 with uploaded images)
    if (
        final_output
        and validation is not None
        and validation.score < 0.4
        and deps.uploaded_image_urls
    ):
        logger.warning(
            "Critical quality issues (score=%.2f), attempting retry for thread %s",
            validation.score, deps.thread_id,
        )
        yield {"type": "retrying", "reason": "检测到关键质量问题，正在重新生成..."}
        try:
            retry_prompt = (
                f"{prompt}\n\n"
                f"[IMPORTANT: Your previous output had these issues: "
                f"{'; '.join(validation.issues)}. "
                f"Fix them in this attempt. Ensure ALL image URLs appear in the output.]"
            )
            retry_result = await agent.run(retry_prompt, deps=deps)
            retry_output = retry_result.output
            # Update conversation history with retry result
            if hasattr(retry_result, "all_messages"):
                all_messages_snapshot = retry_result.all_messages()
            retry_validation = validate_agent_output(
                retry_output,
                deps.uploaded_image_urls,
                source_word_count=deps.source_word_count,
            )
            if retry_validation.score > validation.score:
                yield {"type": "content_clear"}
                chunk_size = 200
                for i in range(0, len(retry_output), chunk_size):
                    yield {"type": "content", "chunk": retry_output[i : i + chunk_size]}
                final_output = retry_output
                logger.info(
                    "Retry improved score: %.2f → %.2f for thread %s",
                    validation.score, retry_validation.score, deps.thread_id,
                )
        except Exception as e:
            logger.warning("Retry failed for thread %s: %s", deps.thread_id, e)

    # 5. Extract document content from editing output (ALL editing modes — fail-closed safety)
    if skill == "editing" and final_output:
        extracted = extract_document_content(final_output)
        if extracted != final_output:
            logger.info("Extracted document content from <document> markers for thread %s", deps.thread_id)
            final_output = extracted

    # 6. 发出 done 事件，携带权威最终输出（不含中间轮叙述文本）
    # 前端用 final_content 做 "Apply to page"，而非累积的 streamed_chunks
    yield {"type": "done", "final_content": final_output or "", "output_type": output_type, "edit_mode": edit_mode}

    # 7. 保存对话历史
    if deps.session_store and all_messages_snapshot:
        try:
            await deps.session_store.save(
                thread_id=deps.thread_id,
                user_id=deps.user_id,
                messages=all_messages_snapshot,
            )
        except Exception as e:
            logger.warning("Failed to save conversation for thread %s: %s", deps.thread_id, e)
