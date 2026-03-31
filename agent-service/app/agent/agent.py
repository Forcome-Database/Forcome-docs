"""核心 Agent 定义 — 模块级双单例。

PydanticAI 工具调用 Agent，取代多层级编排系统。
Agent 实例无状态，deps/model_settings/message_history 都是 run() 的参数。

两套单例：
- _creation_agent: 使用 CREATION_SKILL 提示词（默认，首轮 / 含文件）
- _editing_agent:  使用 EDITING_SKILL 提示词（跟进轮，无新文件）
工具列表准备一次，缓存于 _prepared_tools。
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.tools import Tool
from pydantic_ai.settings import ModelSettings

from app.agent.deps import AgentDeps
from app.agent.skills import CREATION_SKILL, EDITING_SKILL
from app.agent.model_limits import get_max_tokens_for_current_model

logger = logging.getLogger(__name__)

# 模块级双单例 — 全局共享，线程安全（Agent 本身无状态）
_creation_agent: Agent[AgentDeps, str] | None = None
_editing_agent: Agent[AgentDeps, str] | None = None

# 缓存已准备好的工具列表（准备一次，两个 Agent 共享）
_prepared_tools: list[Tool] | None = None


def _prepare_tools(extra_tools: list | None = None) -> list[Tool]:
    """准备并返回工具列表。

    当无 extra_tools 时缓存结果；有 extra_tools 时每次重新构建（测试场景）。
    """
    global _prepared_tools
    from app.agent.tools import ALL_TOOLS
    import sys

    tool_fns = ALL_TOOLS + (extra_tools or [])

    # Tool functions use `RunContext["AgentDeps"]` with TYPE_CHECKING guard,
    # so `AgentDeps` is absent from their module globals at runtime.
    # Inject it before wrapping with Tool() to allow get_type_hints() to resolve.
    for fn in tool_fns:
        mod = sys.modules.get(fn.__module__)
        if mod is not None and not hasattr(mod, "AgentDeps"):
            mod.AgentDeps = AgentDeps  # type: ignore[attr-defined]

    tools = [Tool(t, takes_ctx=True) for t in tool_fns]

    # Only cache when there are no extra_tools (standard production path)
    if not extra_tools:
        _prepared_tools = tools

    return tools


def create_agent(
    system_prompt: str = "",
    model: Any = None,
    extra_tools: list | None = None,
) -> Agent[AgentDeps, str]:
    """创建新 Agent 实例（工厂函数，用于测试或配置变更）。

    Args:
        system_prompt: 覆盖 system prompt。空字符串回退到 CREATION_SKILL。
        model: 覆盖默认模型（测试用）。
        extra_tools: 额外工具列表（测试用）。
    """
    from app.llm.factory import create_pydantic_ai_model

    m = model or create_pydantic_ai_model()
    max_tokens = get_max_tokens_for_current_model()

    # 构建 ModelSettings（动态 max_tokens + Thinking 能力）
    # thinking="high": 对支持 thinking 的模型启用深度推理
    # openai_reasoning_summary="auto": OpenAI Responses API 返回推理摘要文本
    #   → PydanticAI 将其解析为 ThinkingPart → event_bridge 转为 SSE thinking 事件
    #   → 前端折叠展示"已思考 Xs"，类似 MiniMax 的深度分析可见性
    model_settings_kwargs: dict = {
        "max_tokens": max_tokens,
        "thinking": "high",
        "openai_reasoning_summary": "auto",
    }

    # Use provided system_prompt, or fall back to CREATION_SKILL
    effective_prompt = system_prompt if system_prompt else CREATION_SKILL

    # Use cached tools when possible; rebuild if extra_tools provided
    if extra_tools or _prepared_tools is None:
        tools = _prepare_tools(extra_tools)
    else:
        tools = _prepared_tools

    return Agent(
        model=m,
        deps_type=AgentDeps,
        system_prompt=effective_prompt,
        tools=tools,
        output_type=str,
        model_settings=ModelSettings(**model_settings_kwargs),
        retries=2,
        end_strategy="early",
    )


def get_agent(skill: str = "creation") -> Agent[AgentDeps, str]:
    """获取 Agent 单例（懒初始化）。

    Args:
        skill: "creation"（默认）或 "editing"。
    """
    global _creation_agent, _editing_agent

    if skill == "editing":
        if _editing_agent is None:
            _editing_agent = create_agent(system_prompt=EDITING_SKILL)
        return _editing_agent
    else:
        if _creation_agent is None:
            _creation_agent = create_agent(system_prompt=CREATION_SKILL)
        return _creation_agent


def reset_agent() -> None:
    """重置所有 Agent 单例和缓存工具（用于测试或配置变更后重建）。"""
    global _creation_agent, _editing_agent, _prepared_tools
    _creation_agent = None
    _editing_agent = None
    _prepared_tools = None
