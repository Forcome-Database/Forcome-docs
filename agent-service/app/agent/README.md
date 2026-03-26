# Docmost Intelligent Agent

PydanticAI 工具调用 Agent，取代多层级编排系统（engine.py 1266 行 → ~440 行）。

## 架构

单一 ReAct Agent 通过工具调用实现 MiniMax 级别的"理解→工具调用→创作"体验：

```
用户指令 + 文件
  → PydanticAI Agent（模块级单例）
      ├ system_prompt: TipTap 创作 Skill（2000+ tokens 强制规则）
      ├ tools: [extract_document, scrape_url, search_web, read_page]
      ├ model_settings: 动态 max_tokens（per-model）
      └ event_bridge → SSE 流式事件
  → 后验证（图片完整性）
  → Markdown 输出
```

## 文件说明

| 文件 | 职责 | 行数 |
|------|------|------|
| `agent.py` | Agent 单例定义（model + tools + skill） | ~60 |
| `deps.py` | 运行时依赖容器（每请求独立） | ~30 |
| `skill.py` | TipTap 创作规则（system_prompt 2000+ tokens） | ~100 |
| `event_bridge.py` | PydanticAI 事件 → SSE 事件 | ~70 |
| `runner.py` | 执行引擎（会话管理 + 取消 + 后验证） | ~80 |
| `validator.py` | 输出后验证器（图片完整性 + 质量检查） | ~50 |
| `model_limits.py` | 动态 max_tokens 查找（per-model） | ~40 |
| `tools/` | 可扩展工具集（4 个工具） | ~200 |

## 新增工具

1. 在 `tools/` 下创建 `my_tool.py`
2. 实现 `async def my_tool_tool(ctx: RunContext[AgentDeps], ...) -> str`，必须有 docstring
3. 在 `tools/__init__.py` 的 `ALL_TOOLS` 中注册
4. 写测试

## API 端点

`POST /agent/v2/run` — 智能 Agent 端点（SSE 流）

Request:
```json
{
  "prompt": "用户指令",
  "thread_id": null,
  "page_id": "uuid",
  "workspace_id": "uuid",
  "user_id": "uuid",
  "files": [{"content_b64": "...", "filename": "doc.pdf", "mimetype": "application/pdf"}]
}
```

## 重要修正记录

- **E-01**: FinalResultEvent 在内容流完成前触发，不映射为 done，done 在循环结束后发出
- **W-04**: firecrawl_scrape/tavily_search 等同步工具通过 asyncio.to_thread() 调用
- **ThinkingConfig**: pydantic-ai 1.72.0 使用 ModelSettings(thinking="high")，不是类
