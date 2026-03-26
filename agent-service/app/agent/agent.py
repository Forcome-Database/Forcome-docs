"""核心 Agent 定义 — 模块级单例。

PydanticAI 工具调用 Agent，取代多层级编排系统。
Agent 实例无状态，deps/model_settings/message_history 都是 run() 的参数。
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.tools import Tool
from pydantic_ai.settings import ModelSettings

from app.agent.deps import AgentDeps
from app.agent.skill import TIPTAP_CREATION_SKILL
from app.agent.model_limits import get_max_tokens_for_current_model

logger = logging.getLogger(__name__)

# 模块级单例 — 全局共享，线程安全（Agent 本身无状态）
_agent: Agent[AgentDeps, str] | None = None


def create_agent(
    model: Any = None,
    extra_tools: list | None = None,
) -> Agent[AgentDeps, str]:
    """创建新 Agent 实例（工厂函数，用于测试或配置变更）。

    Args:
        model: 覆盖默认模型（测试用）。
        extra_tools: 额外工具列表（测试用）。
    """
    from app.orchestrator.llm_factory import create_pydantic_ai_model
    from app.agent.tools import ALL_TOOLS

    m = model or create_pydantic_ai_model()
    max_tokens = get_max_tokens_for_current_model()

    # 构建 ModelSettings（动态 max_tokens + Thinking 能力）
    # ModelSettings 是 TypedDict，直接传关键字参数构造
    # thinking 字段类型: ThinkingLevel = Union[bool, Literal['minimal','low','medium','high','xhigh']]
    # 不支持 thinking 的 provider 会静默忽略该字段
    model_settings_kwargs: dict = {"max_tokens": max_tokens, "thinking": "high"}

    # Tool functions use `RunContext["AgentDeps"]` with TYPE_CHECKING guard,
    # so `AgentDeps` is absent from their module globals at runtime.
    # Inject it before wrapping with Tool() to allow get_type_hints() to resolve.
    import sys
    for fn in ALL_TOOLS + (extra_tools or []):
        mod = sys.modules.get(fn.__module__)
        if mod is not None and not hasattr(mod, "AgentDeps"):
            mod.AgentDeps = AgentDeps  # type: ignore[attr-defined]

    tools = [Tool(t, takes_ctx=True) for t in (ALL_TOOLS + (extra_tools or []))]

    return Agent(
        model=m,
        deps_type=AgentDeps,
        system_prompt=TIPTAP_CREATION_SKILL,
        tools=tools,
        output_type=str,
        model_settings=ModelSettings(**model_settings_kwargs),
        retries=2,
        end_strategy="early",
    )


def get_agent() -> Agent[AgentDeps, str]:
    """获取 Agent 单例（懒初始化）。"""
    global _agent
    if _agent is None:
        _agent = create_agent()
    return _agent


def reset_agent() -> None:
    """重置 Agent 单例（用于测试或配置变更后重建）。"""
    global _agent
    _agent = None
