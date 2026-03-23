# Docmost 项目指南

## 项目简介
Docmost v0.25.3 — 开源协作文档管理系统（类 Notion/Confluence），基于 AGPL 3.0 许可证。

## 技术栈
- **后端**：NestJS 11 + Fastify + Kysely（PostgreSQL） + Redis + BullMQ
- **前端**：React 18 + TypeScript + Vite + Mantine + TipTap
- **协作**：Hocuspocus + Yjs
- **AI**：Vercel AI SDK v6，支持 OpenAI / OpenAI-Compatible / Gemini / Ollama
- **AI Agent**：Python 3.12 + FastAPI + LangGraph + Docling + Tavily + Firecrawl + Pillow

## 企业功能开源化

本项目已完成 EE 模块的后端实现和前端门控移除，详细文档：

- **[重构细节](docs/ee-refactor-details.md)** — 新建/修改文件清单、设计决策、环境变量配置
- **[踩坑记录](docs/ee-refactor-pitfalls.md)** — TypeScript 编译、数据库迁移、PostgreSQL 扩展、AI SDK 行为等问题及解决方案

## Wiki × Docmost 深度集成

VitePress 知识库（`wiki/`）已深度集成 Docmost，作为公开只读前端。详细文档：

- **[集成细节](docs/wiki-integration-details.md)** — 架构设计、API 端点、新建/修改文件清单、数据流、部署方案
- **[踩坑记录](docs/wiki-integration-pitfalls.md)** — VitePress 路由拦截、CORS、SSR 兼容、Vue 响应式、API 响应格式等问题及解决方案

## AI 提示词与模板管理

三层覆盖架构（系统默认 → 管理员工作区级 → 用户个人级），详细文档：

- **[模板管理重构细节](docs/ai-template-management.md)** — 架构设计、权限模型、数据库设计、API 端点、文件清单、踩坑记录

## AI Agent 智能体

独立 Python 微服务（`agent-service/`），通过 LangGraph 编排 Plan-Execute-Review 闭环，支持文档解析、网络搜索、图片生成/标注/理解等 9 个工具。详细文档：

- **[重构细节与踩坑](docs/ai-agent-refactor-details.md)** — 架构、文件清单、6 个踩坑与解决方案
- **[架构设计](docs/plans/2026-03-03-ai-agent-architecture-design.md)** — 完整设计方案

**关键约束**：
- NestJS 网关用 `http.request`（非 `fetch`）代理 SSE，否则流被缓冲
- Agent 节点通过 `asyncio.Queue` 侧信道推送实时事件（非 `astream`）
- `agent-service/app/config.py` 读取 `../.env`（根目录），URL 自动从 `PORT` 端口变量派生

## Docker 部署与环境管理

支持手动启动和 Docker 两种模式，通过 `setup.sh`/`setup.bat` + `dev`/`prod` 参数切换。详细文档：

- **[Docker 部署设计](docs/superpowers/specs/2026-03-23-docker-setup-restructure-design.md)** — 文件结构、服务矩阵、Override 模式、地址兼容方案

## 端口统一配置

所有服务端口由 `.env` 文件顶部的 4 个核心变量集中管控，URL 由代码自动派生：

| 变量 | 默认值 | 服务 |
|------|--------|------|
| `PORT` | `3000` | Docmost NestJS 主服务 |
| `VITE_PORT` | `5173` | React 前端 Vite 开发服务器 |
| `WIKI_PORT` | `5175` | Wiki VitePress |
| `AGENT_PORT` | `8100` | Agent Service (Python) |

修改端口只需改端口变量，以下 URL 自动从端口派生（开发环境无需手动设置）：
- `APP_URL` ← `PORT`（`environment.service.ts`）
- `WIKI_URL` / `VITE_WIKI_URL` ← `WIKI_PORT`（`environment.service.ts` / `client/vite.config.ts`）
- `VITE_DOCMOST_API_URL` ← `PORT`（`wiki config.ts`）
- `VITE_ADMIN_URL` ← `VITE_PORT`（`wiki config.ts`）
- `AGENT_SERVICE_URL` ← `AGENT_PORT`（`environment.service.ts`）
- `DOCMOST_INTERNAL_URL` ← `PORT`（`agent config.py`）

生产环境必须显式设置域名 URL（域名无法从端口推导）。

## 开发环境启动

### 方式一：手动启动（直接运行进程）

```bash
# 安装依赖
pnpm install

# 配置 .env（参考 .env.example）
# 关键项：DATABASE_URL, REDIS_URL, APP_SECRET, AI 配置

# 启动 Docmost 主服务（终端 1）
pnpm dev

# 启动 Agent 服务（终端 2）
cd agent-service && pip install -e ".[dev]" && python run.py

# 启动 Wiki（终端 3，可选）
cd wiki && pnpm install && pnpm docs:dev
```

### 方式二：Docker 启动（全容器化）

```bash
# 配置 .env.dev（参考 .env.example）
# 数据库和 MinIO 使用外部资源，Redis 由 Docker 管理

# 启动开发环境
./setup.sh dev          # Linux/Mac
setup.bat dev           # Windows

# 查看日志
./setup.sh dev logs

# 停止
./setup.sh dev down
```

### 生产环境部署

```bash
# 配置 .env.prod（必须设置域名 URL）
# 启动生产环境
./setup.sh prod
```

**Docker 文件结构**：
- `docker-compose.yml` — 基础层（Redis + 网络）
- `docker-compose.dev.yml` — 开发覆盖层（volume mount + 热重载）
- `docker-compose.prod.yml` — 生产覆盖层（构建镜像 + nginx Wiki）
- `docker/` — 开发/生产用 Dockerfile 和 nginx 配置

**注意**：如果系统环境变量中存在 `OPENAI_API_KEY` 等变量，会覆盖 `.env` 文件中的值。PowerShell 中可用 `$env:OPENAI_API_KEY="sk-xxx"` 临时覆盖。

## PostgreSQL 扩展依赖

运行本项目需要以下 PostgreSQL 扩展：
- `unaccent` — 全文搜索去重音
- `pg_trgm` — 模糊搜索
- `vector`（pgvector）— AI 语义搜索向量存储

如使用非标准安装的 PostgreSQL（如宝塔面板），需手动编译安装 contrib 和 pgvector，详见踩坑记录。

## EE 模块关键约束

EE 服务通过 `require()` 动态加载，**导出类名必须精确匹配**：
- `LicenseService` — 被 `license-check.service.ts` require
- `ApiKeyService` — 被 `jwt.strategy.ts` 通过 ModuleRef 获取
- `MfaService` — 被 `auth.controller.ts` 通过 ModuleRef 获取

## 全局约定
- 所有 API 使用 POST 方法，全局前缀 `/api`
- 主键使用 UUID v7
- 软删除使用 `deletedAt` 字段
- 列表查询使用游标分页（`executeWithCursorPagination`）
- Repository 方法支持 `trx` 事务参数
