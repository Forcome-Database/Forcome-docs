# AI Agent 智能体重构 — 开发记录

> 创建日期：2026-03-04
> 基于设计文档：`docs/plans/2026-03-03-ai-agent-architecture-design.md`

## 概述

将 Docmost 现有的 AI 助手从简单对话式生成，升级为 LangGraph 驱动的自主智能体（Agent）。新增独立 Python 微服务（`agent-service/`），通过 NestJS 网关层代理，前端在 AI Creator 面板中增量集成深度模式。

### 核心能力

| 能力 | 实现方式 |
|------|----------|
| 全模态文档解析 | Docling（PDF/Word/Excel/TXT/HTML/MD/Image OCR） |
| 深度调研 | Tavily 搜索 + Firecrawl 网页爬取 + Docmost RAG 知识库检索 |
| 图片处理 | 生成（OpenAI 兼容 API）+ 标注（Pillow）+ 理解（VLM） |
| 上下文感知修改 | 全文感知 + 选区精准替换 + 对话历史 |
| Plan-Execute-Review | LangGraph 闭环编排（最多 3 次迭代） |

---

## 架构

```
                    Docmost (NestJS)
                         │
              AgentGateway Controller
              (JWT 认证 + SSE 代理)
                         │ http.request (chunked)
                         ▼
              Agent Service (Python FastAPI)
                         │
                   LangGraph 图
         ┌────────┬──────────┬────────┐
       Planner  Researcher  Executor  Reviewer
                    │           │
              9 个 LangGraph Tools
```

### 通信协议

- **NestJS → Agent**: HTTP POST JSON + `X-Internal-Secret` 头
- **Agent → NestJS**: SSE 事件流（`text/event-stream`）
- **实时推送**: 通过 `asyncio.Queue` 侧信道，节点执行中即时推送事件（非等节点完成）
- **SSE 代理**: NestJS 用 `http.request` + `proxyRes.on('data')` 管道（非 `fetch`，因为 fetch 会缓冲 SSE）

### SSE 事件类型

```typescript
{ type: "step_start",  step: string, description: string }
{ type: "step_done",   step: string, result_summary: string }
{ type: "content",     chunk: string }   // 流式文档内容
{ type: "image",       url: string, alt: string }
{ type: "error",       message: string }
{ type: "done",        final_content: string, insert_mode: string }
```

---

## 新增文件清单

### Python Agent Service（`agent-service/`）

| 文件 | 功能 |
|------|------|
| `pyproject.toml` | 项目依赖（LangGraph, Docling, FastAPI, Tavily, Firecrawl, Pillow） |
| `Dockerfile` / `.dockerignore` | Docker 部署（python:3.12-slim + Tesseract OCR） |
| `app/main.py` | FastAPI 入口 + `/agent/run` SSE 端点 + `/agent/stop` 终止 |
| `app/config.py` | 双层配置（AGENT_* 优先，回退 AI_*），读取根目录 `.env` |
| `app/middleware/auth.py` | `X-Internal-Secret` 内部通信密钥验证 |
| `app/schemas/request.py` | `AgentRunRequest` / `AgentStopRequest` Pydantic 模型 |
| `app/schemas/response.py` | SSE 事件类型（7 种事件的 Pydantic 定义） |
| `app/agent/state.py` | `AgentState` TypedDict（30+ 字段） |
| `app/agent/llm.py` | LLM 工厂（支持 OpenAI / OpenAI-Compatible / Gemini） |
| `app/agent/graph.py` | LangGraph 图定义与编译（4 节点 + 条件循环） |
| `app/agent/events.py` | `asyncio.Queue` 实时事件系统 |
| `app/agent/nodes/planner.py` | 规划器：意图分析 → 结构化执行计划 |
| `app/agent/nodes/researcher.py` | 调研器：文件解析 + 搜索 + 爬取 + 图片上传 |
| `app/agent/nodes/executor.py` | 执行器：LLM 流式生成 + 图片 URL 引用 |
| `app/agent/nodes/reviewer.py` | 审查器：质量评审 → 通过/修订 |
| `app/tools/registry.py` | 工具注册表（register/get/list） |
| `app/tools/tavily_search.py` | 网络搜索工具 |
| `app/tools/firecrawl_scrape.py` | 网页爬取工具 |
| `app/tools/docling_parser.py` | 文档解析工具（返回 JSON: text + images） |
| `app/tools/nanobana_imggen.py` | 图片生成工具（OpenAI 兼容 chat/completions） |
| `app/tools/image_annotate.py` | 图片标注工具（Pillow：箭头/文字/框选/高亮） |
| `app/tools/vlm_understand.py` | 图片理解工具（VLM 多模态） |
| `app/tools/docmost_api.py` | Docmost API 工具（page_read / rag / upload） |

### NestJS 网关层

| 文件 | 功能 |
|------|------|
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts` | 模块注册 |
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` | SSE 代理控制器（multipart 解析 + `http.request` 管道） |
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts` | HTTP 转发服务 |
| `apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts` | 请求 DTO |
| `apps/server/src/ee/ai/agent-gateway/dto/agent-stop.dto.ts` | 停止 DTO |

### 前端

| 文件 | 操作 | 功能 |
|------|------|------|
| `apps/client/src/ee/ai/types/agent.types.ts` | 新建 | `AgentStepInfo` + `AgentSSEEvent` 类型 |
| `apps/client/src/ee/ai/services/agent-service.ts` | 新建 | `agentGenerate()` SSE 流式调用 |
| `apps/client/src/ee/ai/hooks/use-agent.ts` | 新建 | `useAgent(pageId)` Hook（run/stop/steps） |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx` | 新建 | 步骤进度展示组件 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.module.css` | 新建 | 步骤样式（dark mode 支持） |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts` | 修改 | 新增 `agentModeAtom` + `agentStepsAtom` |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` | 修改 | IconBrain 深度模式开关 + Agent 流程路由 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx` | 修改 | AI 气泡内渲染步骤进度 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx` | 修改 | 传递 `isLast` prop |

### 修改的现有文件

| 文件 | 改动 |
|------|------|
| `apps/server/src/ee/ee.module.ts` | 动态导入 `AgentGatewayModule` |
| `apps/server/src/integrations/environment/environment.service.ts` | 新增 `getAgentServiceUrl()` + `getAgentInternalSecret()` |
| `docker-compose.yml` | 新增 `agent-service` 容器 |
| `.env.example` | 新增 Agent 环境变量段 |

---

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `AGENT_SERVICE_URL` | 是 | `http://agent-service:8100` | Agent 服务地址 |
| `AGENT_INTERNAL_SECRET` | 是 | - | 内部通信密钥 |
| `AGENT_IMAGE_API_URL` | 否 | `https://api.forcome.com/v1beta` | 图片生成 API（OpenAI 兼容） |
| `AGENT_IMAGE_MODEL` | 否 | `gemini-3-pro-image-preview` | 图片生成模型 |
| `TAVILY_API_KEY` | 否 | - | Tavily 搜索（留空则跳过搜索步骤） |
| `FIRECRAWL_API_KEY` | 否 | - | Firecrawl 爬虫 |
| `AGENT_LLM_PROVIDER` | 否 | 继承 `AI_DRIVER` | Agent 专用 LLM 驱动 |
| `AGENT_LLM_MODEL` | 否 | 继承 `AI_COMPLETION_MODEL` | Agent 专用模型 |
| `AGENT_LLM_API_KEY` | 否 | 继承 `OPENAI_API_KEY` | Agent 专用 API Key |
| `AGENT_MAX_ITERATIONS` | 否 | `3` | Plan-Execute-Review 最大循环次数 |

---

## 开发环境启动

```bash
# 1. Docmost 主服务（终端 1）
cd E:\test\Docmost
pnpm dev

# 2. Agent 服务（终端 2）
cd E:\test\Docmost\agent-service
pip install -e ".[dev]"
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload

# 3. 确保 .env 中：
AGENT_SERVICE_URL=http://localhost:8100   # 本地开发
# Docker 部署时改为 http://agent-service:8100
```

---

## 踩坑记录

### 1. Node.js fetch 缓冲 SSE 流

**现象**：前端只在 Agent 全部执行完毕后才一次性收到所有事件，没有实时进度。

**原因**：NestJS 网关用 `fetch()` 转发 Agent 的 SSE 响应，但 Node.js 的 `fetch()` 会缓冲 `ReadableStream`，不是 chunked 实时传输。

**解决**：改用 `http.request` + `proxyRes.on('data', chunk => res.raw.write(chunk))`，直接管道转发。

```typescript
// ❌ fetch 会缓冲 SSE
const resp = await fetch(agentUrl);
const reader = resp.body.getReader();
while (true) {
  const { done, value } = await reader.read(); // 阻塞到全部完成
  res.raw.write(value);
}

// ✅ http.request 真正的 chunked streaming
const proxyReq = http.request(agentUrl, (proxyRes) => {
  proxyRes.on('data', (chunk) => res.raw.write(chunk)); // 实时！
  proxyRes.on('end', () => res.raw.end());
});
```

### 2. LangGraph astream 仅在节点完成时推送

**现象**：Planner 完成后显示步骤，但 Researcher 解析 PDF 期间无反馈（可能持续数十秒）。

**原因**：`agent_graph.astream()` 按节点粒度 yield，节点执行中不推送中间事件。

**解决**：引入 `asyncio.Queue` 侧信道。节点通过 `emit(task_id, event)` 即时推送事件到队列，SSE 端点从队列实时读取。图用 `asyncio.create_task(graph.ainvoke())` 后台执行。

```python
# app/agent/events.py
_event_queues: dict[str, asyncio.Queue] = {}

async def emit(task_id: str, event: dict):
    q = _event_queues.get(task_id)
    if q:
        await q.put(event)

# 节点中：
await emit(tid, {"type": "step_start", "step": "parse", "description": "正在解析文件..."})
```

### 3. Python Agent 读不到 .env

**现象**：Agent 服务启动后，NestJS 转发请求返回 401 `Invalid internal secret`。

**原因**：Agent 在 `agent-service/` 目录启动，`pydantic-settings` 默认读当前目录的 `.env`，但密钥配置在根目录 `E:\test\Docmost\.env`。

**解决**：`model_config = {"env_file": ["../.env", ".env"], ...}` — 先读上级目录，再读当前目录。

### 4. hatchling 找不到包目录

**现象**：`pip install -e .` 报错 `Unable to determine which files to ship inside the wheel`。

**原因**：项目名 `docmost-agent` 对应的包名应该是 `docmost_agent`，但代码在 `app/` 目录。

**解决**：在 `pyproject.toml` 添加 `[tool.hatch.build.targets.wheel] packages = ["app"]`。

### 5. PDF 图片提取后显示空白

**现象**：LLM 生成 `![Android 截图]()` 无 src 属性，图片显示空白。

**原因**：Docling 解析 PDF 只提取了文本，图片没有被提取和上传。LLM 看到原文提及图片就生成了空引用。

**解决**（三层防护）：
1. **Docling 返回 JSON**: `{"text": "...", "images": [{"b64": "...", "desc": "..."}]}`，通过 `ImageRefMode.EMBEDDED` 提取图片
2. **Researcher 上传**: 解析后将 base64 图片逐个上传到 Docmost `/api/files/upload`，获取真实 URL
3. **Executor 引用**: 将图片 URL 列表传入 LLM prompt，LLM 在合适位置用 `![desc](real-url)` 引用
4. **兜底过滤**: `_strip_empty_images()` 正则替换空/占位图片引用为斜体文字

### 6. TypeScript error?.message on unknown

**现象**：`catch (error)` 中访问 `error?.message` 报 TS2339。

**原因**：TypeScript strict 模式下 `catch` 的 `error` 类型是 `unknown`。

**解决**：`const errMsg = error instanceof Error ? error.message : 'Agent 服务不可用';`

---

## 设计文档

- **[架构设计](docs/plans/2026-03-03-ai-agent-architecture-design.md)** — 完整架构、9 工具、SSE 协议、部署方案
- **[实施计划](docs/plans/2026-03-03-ai-agent-impl-plan.md)** — 6 Phase, 21 Tasks, ~50 文件

## 提交历史（22 commits）

```
1b253c5 feat(agent): 实现 PDF 图片提取 → 上传 → 文档引用完整管线
70275ce fix(agent): 硬过滤空图片引用，替换为斜体文字描述
b304f29 fix(agent): 修复图片不显示问题
865d81d fix(agent): 用 Node.js http.request 替代 fetch 修复 SSE 流式代理
69a8441 fix(agent): 改用 asyncio.Queue 实时事件推送，解决节点执行中无反馈问题
a22d131 fix(agent): 读取根目录 .env 解决本地开发密钥不匹配
8838ef1 feat(agent): 集成 Agent 深度模式到 AI Creator 面板
32cd9a7 fix(agent): 修复 pyproject.toml 包路径和 Python 版本要求
bfc1f9a chore: 统一 .env.example Agent 配置段格式与中文注释
4ba8a4d fix(agent): 图片生成改用 OpenAI 兼容格式 (forcome.com/v1beta)
e2e3218 feat(agent): add Docker deployment config for agent-service
4d00016 feat(agent): add frontend agent types, service, hooks, and step component
5e588e7 feat(agent): add NestJS gateway layer (controller + service + module)
6fac813 feat(agent): build LangGraph graph and add /agent/run SSE endpoint
28ca518 feat(agent): implement four LangGraph nodes (planner, researcher, executor, reviewer)
ef3c90d feat(agent): define AgentState and LLM factory
d45b689 feat(agent): add image tools and Docmost API tools
1116dcb feat(agent): add firecrawl_scrape and docling_parser tools
b465054 feat(agent): add tool registry and tavily_search tool
adccf9f feat(agent): add Pydantic request/response schemas for agent API
4d9efad feat(agent): add FastAPI entry point with health check and auth middleware
3e45328 feat(agent): scaffold Python agent-service project with config
```
