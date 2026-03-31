# Agent Service 架构说明

> 状态：当前实现（2026-03-31 更新，V1 Orchestrator 已完整移除）

## 概述

`agent-service/` 是 Docmost 的独立 Python AI 服务，基于 PydanticAI ReAct Agent 架构。

- FastAPI 接口层
- PydanticAI 双 Agent 单例（Creation + Editing）
- Skill 路由（creation / editing 自动选择）
- 5 个工具：文档提取、图片理解、网页抓取、网络搜索、页面读取
- Redis 多轮会话存储
- SSE 实时事件流

NestJS 通过 `/api/agent/v2/run` 将请求代理到本服务。

## 核心文件

| 文件 | 作用 |
|------|------|
| `app/main.py` | FastAPI 入口，`/agent/v2/run` + `/agent/stop` + `/agent/web-search` + `/health` |
| `app/agent/runner.py` | Agent 执行引擎，流式产出 SSE 事件 |
| `app/agent/agent.py` | PydanticAI Agent 双单例工厂（creation / editing） |
| `app/agent/deps.py` | AgentDeps 运行时依赖容器 |
| `app/agent/skill_router.py` | 基于上下文选择 creation 或 editing skill |
| `app/agent/skills/creation.py` | 文档创作 skill（6 步思考框架） |
| `app/agent/skills/editing.py` | 文档编辑 skill（保真框架 + `<document>` 标记） |
| `app/agent/skills/shared.py` | 共享 TipTap 格式规则 |
| `app/agent/event_bridge.py` | PydanticAI 事件 → SSE 事件映射 |
| `app/agent/validator.py` | 输出后验证（长度、图片、OCR 噪声、压缩率） |
| `app/agent/conversation_store.py` | Redis 多轮会话持久化（滑动窗口 6 轮，24h TTL） |
| `app/agent/cancellation.py` | 内存任务取消注册表 |
| `app/agent/model_limits.py` | 动态 max_tokens 计算 |
| `app/llm/factory.py` | PydanticAI 模型实例工厂（OpenAI / Gemini / Ollama / Compatible） |

### 工具

| 工具 | 文件 | 作用 |
|------|------|------|
| `extract_document_tool` | `app/agent/tools/extract_document.py` | PDF/DOCX/PPTX 文本 + 图片提取（MinerU） |
| `describe_images_tool` | `app/agent/tools/describe_images.py` | VLM 批量图片理解 |
| `scrape_url_tool` | `app/agent/tools/scrape_url.py` | Firecrawl 网页抓取 |
| `search_web_tool` | `app/agent/tools/search_web.py` | Tavily 网络搜索 |
| `read_page_tool` | `app/agent/tools/read_page.py` | 读取 Docmost 页面内容 |

### 共享服务

| 文件 | 作用 |
|------|------|
| `app/config.py` | 配置（环境变量、LLM 设置、Redis/数据库 URL） |
| `app/middleware/auth.py` | X-Internal-Secret 鉴权 |
| `app/tools/docmost_api.py` | Docmost HTTP 客户端（页面读取、图片上传） |
| `app/tools/source_image_store.py` | 图片上传到 Docmost 存储 |
| `app/tools/firecrawl_scrape.py` | Firecrawl 抓取服务 |
| `app/tools/tavily_search.py` | Tavily 搜索服务 |
| `app/tools/vlm_understand.py` | VLM 图片描述服务 |
| `app/tools/mineru_client.py` | MinerU 文档解析客户端 |
| `app/workers/asset_parser.py` | 文档解析 worker（MinerU） |
| `app/models/source_assets.py` | SourceImagePayload 数据模型 |
| `app/models/asset_map.py` | AssetItem / AssetMap 数据模型 |

## API 接口

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/agent/v2/run` | 智能写作 Agent（SSE 流） |
| POST | `/agent/stop` | 取消运行中的任务 |
| POST | `/agent/web-search` | Wiki Q&A 网络搜索回退 |

## SSE 事件协议

`/agent/v2/run` 返回的 SSE 事件类型：

| 事件 | 说明 |
|------|------|
| `session` | 会话信息（thread_id, task_id） |
| `thinking` | 模型推理过程（多阶段，含 phase 字段） |
| `content` | 流式文本内容 chunk |
| `tool_call` | 工具调用开始（tool 名称 + 描述） |
| `tool_result` | 工具调用完成 |
| `warning` | 后验证警告 |
| `retrying` | 质量重试信号 |
| `content_clear` | 清空前一轮内容（重试时） |
| `done` | 完成（final_content + output_type + edit_mode） |
| `error` | 执行异常 |
| `cancelled` | 任务已取消 |

## Skill 路由

`skill_router.py` 根据以下条件选择 skill：

- 有选区（replace/insert）→ **editing**
- 有对话历史 → **editing**
- 有文件上传 → **creation**
- 默认 → **creation**

## 配置要点

当前关键配置来自根目录 `.env` 与 `app/config.py`：

- `AGENT_PORT`（默认 8100）
- `AGENT_INTERNAL_SECRET`
- `AGENT_SERVICE_URL`
- `DOCMOST_INTERNAL_URL`
- `AGENT_LLM_PROVIDER` / `AGENT_LLM_MODEL` / `AGENT_LLM_API_KEY` / `AGENT_LLM_API_URL`
- `TAVILY_API_KEY`
- `FIRECRAWL_API_KEY`
- `MINERU_ENABLED` 及相关 MinerU 配置
- `REDIS_URL`
- `AGENT_MAX_TOOL_CALLS`（默认 10）

## 历史说明

V1 Orchestrator（`DocumentTaskEngine` + `OrchestratorEngine`）已于 2026-03-30 完整移除：
- 删除 `app/orchestrator/` 目录、`app/schemas/`、V1 models/workers/tools
- 删除 V1 API 端点：`/agent/run`、`/agent/resume`、`/agent/session/{id}`、`/v2/draft/*`
- `llm_factory.py` 迁移至 `app/llm/factory.py`
- 净删除 ~37,000 行代码

如果其他文档仍引用 V1 Orchestrator、LangGraph、DocumentTaskEngine，应视为历史资料。
