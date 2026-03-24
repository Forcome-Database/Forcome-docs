# Agent Service 当前架构说明

> 状态：当前实现说明（2026-03-24 核对）
>
> 历史 LangGraph 方案见：[../docs/ai-agent-refactor-details.md](../docs/ai-agent-refactor-details.md)

## 概述

`agent-service/` 是 Docmost 的独立 Python AI 服务，负责文档级 AI 任务编排。当前运行时基于：

- FastAPI 接口层
- `DocumentTaskEngine` 任务路由层
- `OrchestratorEngine` 编排执行层
- PydanticAI 模型调用
- `Docling` / `Firecrawl` / `Tavily` / `Pillow` 等工具能力
- `PostgreSQL + Redis` 默认会话后端（测试或本地也可切换为 memory）

NestJS 通过 `/api/agent/*` 将请求代理到本服务，服务再以 SSE 持续回推任务进度、等待用户确认、草稿补丁和最终结果。

## 当前工作流分支

`app/orchestrator/document_task_engine.py` 会先按任务类型做顶层路由：

- `inline_rewrite`
  - 对应 `selection_edit`
  - 直接走 `OrchestratorEngine._execute_level1(...)`
- `preservation_patch`
  - 对应严格保留模式的 `document_transform`
  - 走文档保留式 patch 流程
- `draft_synthesis`
  - 对应空白创作、非严格保留改写、多文档综合等任务
  - 再根据复杂度进入 Level 2 或 Level 3

## 编排层级

`app/orchestrator/engine.py` 当前保留了三层执行强度：

- **Level 1**
  - 适合局部改写、翻译、润色、轻量编辑
  - 以 `simple_edit -> finalize` 为主
- **Level 2**
  - 适合中等复杂度的文档改写
  - 包含证据收集、brief / blueprint 确认、再写作与收尾
- **Level 3**
  - 适合复杂创作、多文档综合、需要完整规划和逐段写作的任务
  - 会进入更完整的 section writer / review / fix 路径

当前实现已经不是 LangGraph 图编排，仓库中若仍出现 LangGraph 描述，应视为历史资料。

## 核心文件

| 文件 | 作用 |
|------|------|
| `app/main.py` | FastAPI 入口，暴露运行、恢复、查询、停止和草稿接口 |
| `app/orchestrator/document_task_engine.py` | 文档任务优先的顶层路由层 |
| `app/orchestrator/engine.py` | 主编排器，负责 Level 1 / 2 / 3 执行 |
| `app/orchestrator/session_store.py` | 会话快照、运行态和取消状态的统一入口 |
| `app/orchestrator/llm_factory.py` | 基于配置生成 PydanticAI 模型实例 |
| `app/orchestrator/tools/` | 编排工具，如复杂度分析、brief、blueprint、evidence、finalize |
| `app/workers/` | 专职 worker，如 `section_writer`、`evaluator`、`fixer`、`asset_parser` |
| `app/schemas/request.py` | 运行、恢复、停止请求模型 |
| `app/schemas/response.py` | SSE 事件协议 |
| `app/agent/events.py` | `asyncio.Queue` 事件队列 |
| `app/agent/cancellation.py` | 任务取消注册表 |

## API 接口

当前代码中已验证存在以下接口：

- `GET /health`
- `POST /agent/run`
- `POST /agent/resume`
- `GET /agent/session/{session_id}`
- `POST /agent/stop`
- `POST /v2/draft/get`
- `POST /v2/draft/merge`
- `POST /v2/draft/delete`

其中：

- `/agent/*` 是主运行时接口
- `/v2/draft/*` 是草稿存取接口，仍然保留在当前实现中

## SSE 事件协议

事件模型定义于 `app/schemas/response.py`，当前关键事件包括：

- `session`
- `step_start` / `step_done`
- `content`
- `content_clear`
- `draft_patch`
- `await_input`
- `blocked`
- `section_progress`
- `section_state`
- `complexity_analyzed`
- `fix_applied`
- `document_task`
- `done`
- `error`
- `cancelled`

`await_input` 会在 `brief`、`blueprint`、`review` 等阶段暂停，前端再通过 `/agent/resume` 继续执行。

## 会话与取消

`app/orchestrator/session_store.py` 提供统一的会话 / 运行状态抽象：

- 默认后端：`postgres_redis`
- 可选后端：`memory`
- 快照数据：`CreationSessionSnapshot`
- 运行态数据：任务与线程映射、取消标记

`/agent/stop` 会同时尝试：

- 取消内存中的运行任务
- 标记运行态中的 task cancellation

## NestJS 对接方式

NestJS 侧主要由 `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` 代理：

- `/api/agent/run` → `POST /agent/run`
- `/api/agent/resume` → `POST /agent/resume`
- `/api/agent/session/:id` → `GET /agent/session/{id}`
- `/api/agent/stop` → `POST /agent/stop`

SSE 代理使用 `http.request`，而不是 `fetch`，以避免 Node 侧缓冲导致前端拿不到实时流。

## 配置要点

当前关键配置来自根目录 `.env` 与 `agent-service/app/config.py`：

- `AGENT_PORT`
- `AGENT_INTERNAL_SECRET`
- `AGENT_SERVICE_URL`
- `DOCMOST_INTERNAL_URL`
- `AGENT_LLM_PROVIDER` / `AGENT_LLM_MODEL` / `AGENT_LLM_API_KEY` / `AGENT_LLM_API_URL`
- `TAVILY_API_KEY`
- `FIRECRAWL_API_KEY`
- `MINERU_ENABLED` 及相关 MinerU 配置
- `DATABASE_URL`
- `REDIS_URL`
- `session_backend`

## 维护原则

- 更新本文件前，应先核对 `app/main.py`、`document_task_engine.py`、`engine.py`、`session_store.py` 与测试
- 如果某份文档仍引用 LangGraph 图、`app/agent/graph.py` 或旧节点拓扑，应明确标注为历史资料
