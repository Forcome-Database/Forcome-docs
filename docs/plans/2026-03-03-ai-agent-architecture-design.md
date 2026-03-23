# AI Agent 架构设计：从 AI 助手到智能体重构

> 日期：2026-03-03
> 状态：已批准
> 分支：待创建

## 1. 概述

### 1.1 目标

将 Docmost 现有的 AI 创作功能升级为高度自主的智能体（Agent），具备：

- **全模态文档解析**：PDF、Word、Excel、TXT、Markdown、HTML、URL、图片
- **深度调研**：自主搜索网络 + 爬取网页 + 检索系统知识库
- **插件自主调用**：自主组合工具（图片生成、标注、上传、理解）
- **上下文感知修改**：感知全文、选中段落，精准修改
- **编辑器无缝交付**：自动插入/替换到 TipTap 编辑器

### 1.2 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 部署架构 | 独立 Python 微服务 | LangGraph + Dodling 原生 Python 生态 |
| 文档解析 | 多克林 | 轻量、多格式支持、内置 OCR |
| LLM 配置 | 双层（用Docmost + Agent可覆盖）| 灵活性最大 |
| 前端交互 | 轻量增强（步骤进度嵌入气泡）| 改动最小、体验一致 |
| 图片能力 | 生成(NanoBanana) + 理解(VLM) + 标注(Pillow) | 完整图文能力 |
| 编辑器写入 | 前端 TipTap API 插件 | 简单可靠、协作友好 |

### 1.3 技术栈

- **代理编排**：LangGraph（Plan-Execute-Review闭环）
- **代理服务**：Python 3.12 + FastAPI + Uvicorn
- **文档解析**：Docling 2.x
- **网络搜索**：Tavily AI API
- **网页爬取**：Firecrawl API
- **图片生成**：Nano Banana 2 API
- **图片标注**：Pillow
- **图片理解**：VLM（复用Docmost AI_VLM_MODEL配置）
- **网关层**：NestJS（现有Docmost服务）
- **通信**：REST + SSE（Agent ↔ NestJS），Redis（状态同步）

---

## 2. 系统架构

### 2.1 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│                      Docker Compose 集群                           │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Docmost (NestJS)                          │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐    │  │
│  │  │ AgentGateway │  │ AI Module    │  │ Auth/CASL      │    │  │
│  │  │ Controller   │  │ (existing)   │  │ (existing)     │    │  │
│  │  │              │  │              │  │                │    │  │
│  │  │ POST /api/   │  │ /ai/generate │  │ JWT + Space    │    │  │
│  │  │  agent/run   │  │ /ai/answers  │  │ permissions    │    │  │
│  │  │  agent/stop  │  │ /ai/creator  │  │                │    │  │
│  │  │  agent/tools │  │              │  │                │    │  │
│  │  └──────┬───────┘  └──────────────┘  └────────────────┘    │  │
│  │         │ HTTP/SSE                                          │  │
│  └─────────┼───────────────────────────────────────────────────┘  │
│            │                                                      │
│  ┌─────────▼───────────────────────────────────────────────────┐  │
│  │              Agent Service (Python FastAPI)                  │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │              LangGraph Agent Core                    │   │  │
│  │  │                                                     │   │  │
│  │  │  ┌────────┐  ┌──────────┐  ┌────────┐  ┌────────┐ │   │  │
│  │  │  │Planner │→│Researcher│→│Executor│→│Reviewer│ │   │  │
│  │  │  │  Node  │  │   Node   │  │  Node  │  │  Node  │ │   │  │
│  │  │  └────────┘  └──────────┘  └────────┘  └────────┘ │   │  │
│  │  │       ↑                                    │       │   │  │
│  │  │       └────────── Loop (max 3) ────────────┘       │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                             │  │
│  │  ┌── Tool Registry (9 tools) ──────────────────────────┐   │  │
│  │  │  docling_parser    │ tavily_search   │ firecrawl     │   │  │
│  │  │  nanobana_imggen   │ image_annotate  │ vlm_understand│   │  │
│  │  │  docmost_page_read │ docmost_rag     │ docmost_upload│   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │ PostgreSQL   │  │    Redis     │                              │
│  │ + pgvector   │  │              │                              │
│  └──────────────┘  └──────────────┘                              │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 语言/框架 | 职责 |
|------|-----------|------|
| **代理网关**（新增） | NestJS/TypeScript | JWT认证、空间权限校验、Fastify多部分文件提取、请求转发到代理服务、SSE流式代理 |
| **代理服务**（新增） | Python/FastAPI | LangGraph 编排核心、工具注册与调度、LLM 调用、SSE 事件生成 |
| **工具注册表**（新增） | 蟒蛇 | 9 个标准工具实现，LangGraph Tool 接口，可插拔注册 |
| **AI模块**（现有保留） | NestJS/TypeScript | 保留现有 AI 生成、RAG 搜索、模板管理功能 |

### 2.3 数据流

```
用户输入(文本+文件+模板+选中区域)
    ↓
前端 AI Creator Panel (判断 Agent 模式 or 普通模式)
    ↓ POST /api/agent/run (FormData: files + JSON)
NestJS AgentGateway Controller
    ↓ [1] JWT 认证 + Space WRITER 权限校验
    ↓ [2] Fastify multipart 文件提取 → base64
    ↓ [3] 读取页面上下文 (pageId → title + content + ydoc)
    ↓ [4] 构建请求体 → 转发到 Agent Service
    ↓ HTTP POST + SSE 代理
Agent Service (FastAPI)
    ↓ 验证 AGENT_INTERNAL_SECRET
    ↓ 初始化 LangGraph 图
    ↓
    ├── Planner Node: 分析意图、制定执行计划
    ├── Researcher Node: 调用 Docling/Tavily/Firecrawl/RAG 工具
    ├── Executor Node: LLM 生成 + 穿插图片生成/标注/上传
    └── Reviewer Node: 质量检查 → 通过 or 循环修正
    ↓
SSE 事件流 → NestJS 代理 → 前端
    ↓
前端渲染步骤进度 + 流式内容
    ↓
markdownToHtml → TipTap editor.chain().insertContent()
```

---

## 3. LangGraph Agent核心设计

### 3.1 代理状态（州）

```python
from typing import TypedDict, Literal

class FileInfo(TypedDict):
    filename: str
    mimetype: str
    content_b64: str  # base64 编码

class PlanStep(TypedDict):
    step_id: int
    action: str           # "search" | "parse" | "crawl" | "generate" | "image" | "annotate" | "review"
    description: str
    tool: str | None      # 对应的工具名
    args: dict | None     # 工具参数提示
    status: str           # "pending" | "running" | "done" | "skipped"

class StepEvent(TypedDict):
    type: str             # "step_start" | "step_done" | "tool_call" | "content" | "image" | "error" | "done"
    data: dict

class AgentState(TypedDict):
    # 用户输入
    user_message: str
    conversation_history: list[dict]
    uploaded_files: list[FileInfo]
    template_id: str | None

    # 文档上下文
    page_id: str | None
    page_title: str | None
    page_content: str | None
    selected_text: str | None
    selection_range: dict | None
    insert_mode: Literal["create", "append", "replace"]

    # Agent 工作状态
    plan: list[PlanStep]
    current_step: int
    research_results: list[dict]
    parsed_files: list[dict]
    generated_images: list[dict]

    # 输出
    draft_content: str
    final_content: str
    step_events: list[StepEvent]

    # 控制
    needs_revision: bool
    revision_feedback: str
    iteration_count: int
    max_iterations: int   # 默认 3
```

### 3.2 图结构

```
START → Planner → Researcher → Executor → Reviewer → [通过?]
                                                        │
                                               Yes → END (返回 final_content)
                                               No  → Planner (循环, iteration_count < max_iterations)
```

### 3.3 节点职责

**规划师要点**：
- 输入：用户指令 + 上下文（页面内容、选中文本、对话历史、上传文件元信息）
- 意图分类：新建文档 / 修改段落 / 信息查询 / 翻译润色 / 图文混排
- 输出：结构化执行计划 `list[PlanStep]`，每步标注需要的工具

**研究员要点**：
- 按计划调用工具：`docling_parser`（解析文件）、`tavily_search`（搜索）、`firecrawl_scrape`（爬取）、`docmost_rag`（知识库检索）、`docmost_page_read`（读页面）、`vlm_understand`（图片理解）
- 输出：更新 `research_results` 和 `parsed_files`

**执行者节点**：
- 构建完整 prompt = 系统提示 + 模板 + 调研摘要 + 用户指令 + 上下文
- 调用 LLM 流式生成 Markdown 文档
- 穿插调用 `nanobana_imggen`（图片生成）、`image_annotate`（图片标注）、`docmost_upload`（上传获取 URL）
- 输出：更新 `draft_content`

**评审者要点**：
- LLM 评审：需求满足度、内容完整性、格式正确性
- 通过 → 设置 `final_content`
- 不通过 → 设置 `needs_revision=True` + `revision_feedback`

### 3.4 SSE 事件协议

Agent 执行过程中通过 SSE 推送以下事件：

```typescript
// step_start: Agent 开始执行某个步骤
{ type: "step_start",  data: { step: "search", description: "正在搜索相关资料..." } }

// step_done: 某个步骤完成
{ type: "step_done",   data: { step: "search", result_summary: "找到 5 条相关结果" } }

// tool_call: 工具调用通知（可选，用于调试模式展示）
{ type: "tool_call",   data: { tool: "tavily_search", args: { query: "..." } } }

// content: 流式内容块
{ type: "content",     data: { chunk: "## 1. 项目概述\n\n本项目旨在..." } }

// image: 图片生成/标注完成
{ type: "image",       data: { url: "/api/files/xxx.png", alt: "架构图" } }

// error: 错误信息
{ type: "error",       data: { message: "Tavily API 调用失败" } }

// done: 任务完成，返回最终内容
{ type: "done",        data: { final_content: "...(完整 Markdown)", insert_mode: "create" } }
```

---

## 4.工具园艺（工具注册表）

### 4.1 工具列表

| # | 工具名 | 功能 | 实现 | 外部依赖 |
|---|--------|------|------|----------|
| 1 | `docling_parser` | 解析PDF/Word/Excel/TXT/HTML/MD/Image | 文档SDK | 超立方 OCR |
| 2 | `tavily_search` | 网络搜索，返回结构化结果 | 泰利Python SDK | TAVILY_API_KEY |
| 3 | `firecrawl_scrape` | 爬取URL，返回Markdown | Firecrawl Python SDK | FIRECRAWL_API_KEY |
| 4 | `nanobana_imggen` | AI 图片生成 | HTTP API 调用 | NANOBANA_API_KEY |
| 5 | `image_annotate` | 图片标注（箭头、文字、框选、高亮）| 枕头 | 无 |
| 6 | `vlm_understand` | 图片内容理解与描述 | 浪链VLM | AI_VLM_模型 |
| 7 | `docmost_page_read` | 读取 Docmost 页面内容 | HTTP → Docmost API | DOCMOST_INTERNAL_URL |
| 8 | `docmost_rag` | 向量搜索 Docmost 知识库 | HTTP → Docmost API | DOCMOST_INTERNAL_URL |
| 9 | `docmost_upload` | 上传文件/图片到 Docmost 存储 | HTTP → Docmost API | DOCMOST_INTERNAL_URL |

### 4.2 工具接口规范

所有工具实现 LangGraph Tool 标准接口：

```python
from langchain_core.tools import tool

@tool
def docling_parser(file_content_b64: str, filename: str, mimetype: str) -> str:
    """解析文档文件，返回 Markdown 格式文本。
    支持: PDF, Word(.docx), Excel(.xlsx), TXT, HTML, Markdown, Image(OCR)。
    """
    ...

@tool
def tavily_search(query: str, max_results: int = 5) -> str:
    """搜索网络获取最新信息。返回搜索结果的标题、摘要和链接。"""
    ...

@tool
def firecrawl_scrape(url: str) -> str:
    """爬取指定 URL 的网页内容，返回结构化 Markdown。"""
    ...

@tool
def nanobana_imggen(prompt: str, style: str = "default") -> dict:
    """根据文字描述生成图片。返回图片的 base64 数据和建议的文件名。"""
    ...

@tool
def image_annotate(
    image_b64: str,
    annotations: list[dict]  # [{"type": "arrow|text|box|highlight", "params": {...}}]
) -> str:
    """对图片进行标注（添加箭头、文字、框选、高亮），返回标注后图片的 base64。"""
    ...

@tool
def vlm_understand(image_b64: str, question: str = "描述这张图片的内容") -> str:
    """使用视觉语言模型理解图片内容。返回图片的文字描述。"""
    ...

@tool
def docmost_page_read(page_id: str) -> str:
    """读取 Docmost 系统中指定页面的 Markdown 内容。"""
    ...

@tool
def docmost_rag(query: str, space_id: str | None = None, top_k: int = 5) -> str:
    """在 Docmost 知识库中进行语义搜索，返回相关页面片段。"""
    ...

@tool
def docmost_upload(file_content_b64: str, filename: str, page_id: str) -> str:
    """上传文件/图片到 Docmost 存储，返回可在文档中引用的 URL。"""
    ...
```

---

## 5.NestJS 网关层

### 5.1 新增 API 端点

| 端点 | 功能 | 流式 |
|------|------|------|
| `POST /api/agent/run` | 启动 Agent 任务（文件+指令） | SSE |
| `POST /api/agent/stop` | 终止正在运行的 Agent 任务 | 否 |
| `POST /api/agent/status` | 查询 Agent 任务状态 | 否 |
| `POST /api/agent/tools` | 查询可用工具列表 | 否 |

### 5.2 网关控制器

```typescript
// apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentGatewayController {
  constructor(
    private agentGatewayService: AgentGatewayService,
    private spaceAbility: SpaceCaslAbilityFactory,
  ) {}

  @Post('run')
  async runAgent(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    // 1. 解析 multipart（files + JSON body）
    // 2. 校验 Space 权限（WRITER+）
    // 3. 构建上下文（pageId → 读取页面内容）
    // 4. 转发到 Agent Service（携带 AGENT_INTERNAL_SECRET）
    // 5. 代理 SSE 流回前端
  }

  @Post('stop')
  async stopAgent(@Body() dto: AgentStopDto) {
    // 转发终止请求到 Agent Service
  }

  @Post('tools')
  async getTools() {
    // 查询 Agent Service 可用工具列表
  }
}
```

### 5.3 请求体（NestJS → 代理服务）

```json
{
  "user_message": "帮我写一份关于微服务架构的技术文档",
  "files": [
    { "filename": "requirements.pdf", "mimetype": "application/pdf", "content_b64": "..." }
  ],
  "page_context": {
    "page_id": "019...",
    "page_title": "技术文档",
    "page_content": "# 技术文档\n\n（现有内容...）",
    "selected_text": null,
    "selection_range": null
  },
  "template_id": "technical-doc",
  "conversation_history": [
    { "role": "user", "content": "之前的消息..." },
    { "role": "assistant", "content": "之前的回复..." }
  ],
  "workspace_id": "019...",
  "config": {
    "insert_mode": "create",
    "max_iterations": 3
  }
}
```

### 5.4 安全设计

- **内部通信密钥**：`AGENT_INTERNAL_SECRET`（环境变量），NestJS → Agent Service 每个请求携带 `X-Internal-Secret` 头
- **网络隔离**：Agent Service 仅在 Docker 内网暴露 8100 端口
- **文件校验**：NestJS 层校验文件大小（20MB）、类型白名单，然后以 base64 传递；大文件通过共享存储路径传递
- **权限透传**：NestJS验证用户空间权限后，将workspace_id和user_id提交给代理服务，代理调用Docmost API时携带

---

## 6. 前端集成

### 6.1 交互模式

在现有 AI Creator 面板基础上增量增强：

- **普通模式**（现有）：直接调用 `/api/ai/creator/generate`，简单对话式交互
- **Agent 模式**（新增）：调用 `/api/agent/run`，支持步骤进度展示

### 6.2 Agent 模式触发

两种方式：

1. **显式**：输入框旁「深度模式」开关按钮
2. **自动建议**：上传文件时、指令包含"搜索"/"调研"/"分析"等关键词时

### 6.3 步骤进度展示

嵌入消息气泡内，折叠式展示：

```
┌─────────────────────────────────────────┐
│  🤖 AI Agent                            │
│                                         │
│  ┌─ 执行步骤 ──────────────────────┐   │
│  │ ✅ 分析需求：生成技术文档        │   │
│  │ ✅ 搜索资料：找到 5 条相关结果   │   │
│  │ ✅ 解析文件：proposal.pdf (23页) │   │
│  │ 🔄 正在生成文档内容...           │   │
│  │ ⏳ 质量检查                      │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ## 1. 项目概述                         │
│  本项目旨在...（流式输出中）             │
└─────────────────────────────────────────┘
```

### 6.4 新增/修改文件

**新增**：

| 文件 | 功能 |
|------|------|
| `ai-creator-agent-steps.tsx` | 步骤进度展示组件 |
| `services/agent-service.ts` | 代理SSE API调用 |
| `hooks/use-agent.ts` | Agent 状态管理 |

**修改**：

| 文件 | 改动 |
|------|------|
| `ai-creator-input.tsx` | 新增「深度模式」开关 |
| `ai-creator-atoms.ts` | 新增 `agentModeAtom`, `agentStepsAtom` |
| `ai-creator-message-item.tsx` | 支持 step 事件渲染 |
| `ai-creator-panel.tsx` | 路由到 Agent 或普通流程 |

### 6.5 编辑器插入

复用现有机制：

```typescript
import { markdownToHtml } from '@docmost/editor-ext';

function insertAgentContent(editor, content: string, mode: InsertMode) {
  const html = markdownToHtml(content);
  switch (mode) {
    case 'create':
      editor.chain().clearContent().insertContent(html).run();
      break;
    case 'append':
      editor.chain().focus('end').insertContent(html).run();
      break;
    case 'replace':
      editor.chain().insertContentAt(selectionRange, html).run();
      break;
  }
}
```

---

## 7. 部署方案

### 7.1 Docker Compose 扩展

```yaml
services:
  # 现有服务保持不变: docmost, db, redis

  agent-service:
    build:
      context: ./agent-service
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      - db
      - redis
    environment:
      # 双层 LLM 配置（默认复用 Docmost）
      - AI_DRIVER=${AI_DRIVER}
      - AI_COMPLETION_MODEL=${AI_COMPLETION_MODEL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_API_URL=${OPENAI_API_URL}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      # Agent 独立覆盖（可选）
      - AGENT_LLM_PROVIDER=${AGENT_LLM_PROVIDER:-}
      - AGENT_LLM_MODEL=${AGENT_LLM_MODEL:-}
      - AGENT_LLM_API_KEY=${AGENT_LLM_API_KEY:-}
      - AGENT_LLM_API_URL=${AGENT_LLM_API_URL:-}
      # 工具 API Keys
      - TAVILY_API_KEY=${TAVILY_API_KEY}
      - FIRECRAWL_API_KEY=${FIRECRAWL_API_KEY}
      - FIRECRAWL_API_URL=${FIRECRAWL_API_URL:-https://api.firecrawl.dev}
      - NANOBANA_API_KEY=${NANOBANA_API_KEY}
      # 内部通信
      - AGENT_INTERNAL_SECRET=${AGENT_INTERNAL_SECRET}
      - DOCMOST_INTERNAL_URL=http://docmost:3000
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      # 运行配置
      - AGENT_MAX_ITERATIONS=${AGENT_MAX_ITERATIONS:-3}
    volumes:
      - docmost_data:/app/data/storage
    networks:
      - docmost-network
```

### 7.2 Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY app/ ./app/

EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
```

### 7.3 环境变量汇总

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `AGENT_SERVICE_URL` | 是 | `http://agent-service:8100` | 文档最中配置 |
| `AGENT_INTERNAL_SECRET` | 是 | - | 内部通信密钥 |
| `TAVILY_API_KEY` | 是 | - | 塔维利搜索 |
| `FIRECRAWL_API_KEY` | 是 | - | 火爬虫 |
| `FIRECRAWL_API_URL` | 否 | `https://api.firecrawl.dev` | 自部署 Firecrawl |
| `NANOBANA_API_KEY` | 是 | - | 图片生成 |
| `AGENT_LLM_PROVIDER` | 否 | 继承 `AI_DRIVER` | 覆盖LLM提供者 |
| `AGENT_LLM_MODEL` | 否 | 继承 `AI_COMPLETION_MODEL` | 覆盖LLM模型 |
| `AGENT_LLM_API_KEY` | 否 | 继承 `OPENAI_API_KEY` | 覆盖API密钥 |
| `AGENT_LLM_API_URL` | 否 | 继承 `OPENAI_API_URL` | 覆盖API URL |
| `AGENT_MAX_ITERATIONS` | 否 | `3` | 最大循环次数 |

---

## 8. 新增文件清单

### 8.1 代理服务（Python）

```
agent-service/
├── Dockerfile
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── main.py                        # FastAPI 入口、CORS、路由注册
│   ├── config.py                      # 双层配置加载
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── graph.py                   # LangGraph 图定义与编译
│   │   ├── state.py                   # AgentState TypedDict
│   │   └── nodes/
│   │       ├── __init__.py
│   │       ├── planner.py             # Planner 节点
│   │       ├── researcher.py          # Researcher 节点
│   │       ├── executor.py            # Executor 节点
│   │       └── reviewer.py            # Reviewer 节点
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── registry.py                # 工具注册与发现
│   │   ├── docling_parser.py          # 文档解析
│   │   ├── tavily_search.py           # 网络搜索
│   │   ├── firecrawl_scrape.py        # 网页爬取
│   │   ├── nanobana_imggen.py         # 图片生成
│   │   ├── image_annotate.py          # 图片标注
│   │   ├── vlm_understand.py          # 图片理解
│   │   └── docmost_api.py             # Docmost API 交互（page_read + rag + upload）
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── request.py                 # Pydantic 请求模型
│   │   └── response.py                # SSE 事件模型
│   └── middleware/
│       ├── __init__.py
│       └── auth.py                    # 内部密钥验证
└── tests/
    ├── __init__.py
    ├── test_graph.py
    ├── test_tools/
    │   └── ...
    └── conftest.py
```

### 8.2 NestJS 网关层

```
apps/server/src/ee/ai/agent-gateway/
├── agent-gateway.module.ts
├── agent-gateway.controller.ts
├── agent-gateway.service.ts
└── dto/
    ├── agent-run.dto.ts
    └── agent-stop.dto.ts
```

### 8.3 前端

```
apps/client/src/ee/ai/
├── components/ai-creator/
│   ├── ai-creator-agent-steps.tsx      # 新增
│   ├── ai-creator-agent-steps.module.css  # 新增
│   ├── ai-creator-input.tsx            # 修改
│   ├── ai-creator-atoms.ts            # 修改
│   ├── ai-creator-message-item.tsx     # 修改
│   └── ai-creator-panel.tsx            # 修改
├── services/
│   └── agent-service.ts                # 新增
├── hooks/
│   └── use-agent.ts                    # 新增
└── types/
    └── agent.types.ts                  # 新增
```

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Agent Service响应慢（LangGraph 多步编排）| 用户等待时间长 | SSE 步骤进度实时反馈 + 超时机制 + 可终止 |
| 外部API不可用（Tavily/Firecrawl 挂挂）| 工具调用失败 | 工具级错误处理 + 降级提示 + Reviewer 跳过失败步骤 |
| LLM Token 消耗大（多次调用+审核循环）| 成本高 | max_iterations 限制 + Planner 专业计划 + 精简模型 做 Review |
| 大文件解析内存溢出 | 代理服务崩溃 | 文件大小限制 + Docling 流式解析 + 超时终止 |
| 跨服务通信延迟 | 整体响应变慢 | 内网通信 + 文件通过共享存储传递而非 base64 |
