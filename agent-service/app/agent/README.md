# Docmost Intelligent Agent

PydanticAI 工具调用 Agent，取代多层级编排系统（engine.py 1266 行 → ~600 行）。

## 架构

单一 ReAct Agent 通过工具调用 + 时间线渲染实现文档智能创作：

```
用户指令 + 文件
  → PydanticAI Agent（模块级单例，thinking="high"）
      ├ system_prompt: Think-heavy Skill（思考框架 40% + 格式 30% + 工具策略 30%）
      ├ tools: [extract_document, describe_images, scrape_url, search_web, read_page]
      ├ model_settings: 动态 max_tokens + Gemini thinking 支持
      └ event_bridge → SSE 流式事件
  → runner 执行引擎
      ├ 多阶段思考追踪（thinking_phase 计数器）
      ├ Gemini 截断检测（finish_reason == 'length'）
      ├ 后验证（图片完整性 + 压缩比 + 评分）
      └ 质量重试（score < 0.4 时非流式重试）
  → done 事件携带 authoritative_output（不含中间叙述）
```

## 前端时间线渲染

ReAct 循环中，模型在每轮工具调用前会输出叙述文本（如"需要先提取文档..."）。
前端采用**时间线 + 回溯降级**策略，按事件到达顺序渲染：

1. 文本到达 → 正常显示
2. tool_call 到达 → 前面的文本回溯降级为可折叠"规划"块
3. 最后一轮的文本（无 tool_call 跟随）→ 保持为文档内容
4. "Apply to page" 使用 done.final_content（PydanticAI 权威输出，不含中间叙述）

## 文件说明

| 文件 | 职责 | 行数 |
|------|------|------|
| `agent.py` | Agent 单例定义（model + tools + skill） | ~87 |
| `deps.py` | 运行时依赖容器（每请求独立，含 source_word_count） | ~45 |
| `skill.py` | Think-heavy 创作 Skill（分析维度 + few-shot + 深度校准） | ~270 |
| `event_bridge.py` | PydanticAI 事件 → SSE 事件映射 | ~84 |
| `runner.py` | 执行引擎（会话 + 取消 + 思考追踪 + 截断检测 + 验证 + 重试） | ~220 |
| `validator.py` | 输出后验证器（5 维检查 + 0-1 评分） | ~75 |
| `model_limits.py` | 动态 max_tokens 查找（per-model） | ~53 |
| `cancellation.py` | 任务取消管理 | ~60 |
| `tools/` | 可扩展工具集（5 个工具 + native_image_extractor） | ~600 |

## 工具集

| 工具 | 返回类型 | 用途 |
|------|----------|------|
| `extract_document_tool` | `dict` | 文档文本+图片提取（原生提取优先，MinerU 兜底） |
| `describe_images_tool` | `dict` | VLM 批量图片描述（用于精确图文对应） |
| `scrape_url_tool` | `dict` | 网页内容抓取（Firecrawl + 8000 字截断） |
| `search_web_tool` | `dict` | 互联网搜索（Tavily LLM 优化搜索） |
| `read_page_tool` | `dict` | 读取 Docmost 已有页面内容 |

所有工具返回结构化 dict（Gemini 原生 JSON 支持），包含 `status`、`content`/`results` 等字段。

### 新增工具

1. 在 `tools/` 下创建 `my_tool.py`
2. 实现 `async def my_tool_tool(ctx: RunContext[AgentDeps], ...) -> dict`，必须有 docstring
3. 在 `tools/__init__.py` 的 `ALL_TOOLS` 中注册
4. 写测试

## SSE 事件协议

```
session    → {thread_id}
thinking   → {content?, chunk?, phase?}     ← 多阶段，phase 递增
tool_call  → {tool, description}
tool_result → {status}
content    → {chunk}                         ← 最终文档流式输出
warning    → {issues[], score?}
retrying   → {reason}                        ← 质量重试
content_clear                                ← 重试前清空
done       → {final_content}                 ← 权威输出，用于 Apply to page
error      → {message}
cancelled
```

## API 端点

`POST /agent/v2/run` — 智能 Agent 端点（SSE 流）

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

- **E-01**: FinalResultEvent 在**每一轮**都触发（非仅最终轮），不可用作内容门控
- **W-04**: firecrawl_scrape/tavily_search 等同步工具通过 asyncio.to_thread() 调用
- **ThinkingConfig**: PydanticAI v1.72.0 使用 `ModelSettings(thinking="high")`
- **Timeline**: 叙述文本与文档内容通过前端时间线回溯降级分离，非后端过滤
- **Issue #3393**: PydanticAI output_validator 在流式模式有 bug，用流后验证替代
