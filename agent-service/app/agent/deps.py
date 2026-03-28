"""AgentDeps — 每次 Agent 调用的运行时依赖容器。

通过 RunContext 注入到所有工具函数中，确保每个请求状态完全隔离。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SelectionContext:
    """Editor selection state for targeted editing."""
    edit_mode: str = "full"       # "replace" | "insert" | "full"
    selected_text: str = ""       # Markdown of selected content
    context_before: str = ""      # Preceding blocks as markdown
    context_after: str = ""       # Following blocks as markdown
    document_outline: str = ""    # Heading structure


@dataclass
class AgentDeps:
    """每次 Agent 调用的运行时依赖。通过 RunContext 注入到工具中。

    实例按 (workspace_id, user_id, thread_id) 三元组唯一，不跨请求共享。
    """

    # 请求标识（会话隔离核心）
    thread_id: str
    page_id: str | None
    workspace_id: str
    user_id: str

    # 服务连接
    docmost_base_url: str
    internal_secret: str

    # ConversationStore 实例，用于持久化多轮对话历史（可为 None）
    session_store: Any = None

    # 当前页面内容（编辑模式使用，前端注入或后端 read_page 兜底）
    page_content: str = ""

    # 选区上下文（选区编辑模式使用，前端捕获）
    selection: SelectionContext | None = None

    # 用户上传的文件（由 API 端点填充，格式: list of {"content_b64", "filename", "mimetype"}）
    files: list[dict] = field(default_factory=list)

    # 工具执行中填充的已上传图片 URL 映射（供后验证使用）
    # 格式: {"原始引用/文件名": "Docmost 完整 URL"}
    uploaded_image_urls: dict[str, str] = field(default_factory=dict)

    # 原生提取的图片 payloads（extract_document 填充，describe_images 消费）
    image_payloads: list = field(default_factory=list)
    # 类型: list[SourceImagePayload]，用 list 避免循环导入

    # extract_document 工具填充的源内容词数（供 validator 检测压缩比）
    source_word_count: int = 0
