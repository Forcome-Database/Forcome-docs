# Docmost 项目指南

## 项目简介

Docmost v0.25.3 是一个开源协作文档管理系统（类 Notion / Confluence），基于 AGPL 3.0 许可证。

## 文档导航

先区分文档类型，再决定是否可直接作为“现状”使用：

- **[README.md](README.md)**：仓库总入口，偏外部介绍 + 本地开发入口
- **[docs/README.md](docs/README.md)**：开发文档导航，区分现状文档、历史记录、流程文档与归档
- **[docs/plans/README.md](docs/plans/README.md)**：人工编写的设计与实施计划
- **[docs/superpowers/README.md](docs/superpowers/README.md)**：AI 辅助规格与执行计划
- **[docs/archive/process-docs-manifest.md](docs/archive/process-docs-manifest.md)**：哪些 Markdown 属于开发过程文档、哪些不属于
- **[agent-service/ARCHITECTURE.md](agent-service/ARCHITECTURE.md)**：当前 AI Agent Service 的权威架构说明
- **[docs/ai-agent-refactor-details.md](docs/ai-agent-refactor-details.md)**：2026-03-04 LangGraph 方案的历史开发记录，已不代表当前实现

使用规则：

- `README.md`、`CLAUDE.md`、`agent-service/ARCHITECTURE.md`、包级 `README.md` 可以作为当前入口文档；
- `docs/plans/**`、`docs/superpowers/**`、`docs/archive/**` 都属于过程文档，使用前必须回到代码和测试核实；
- 历史实现记录如果没有明确声明“现状”，默认只代表当时的设计与实现背景。

## 技术栈

- **后端**：NestJS 11 + Fastify + Kysely（PostgreSQL）+ Redis + BullMQ
- **前端**：React 18 + TypeScript + Vite + Mantine + TipTap
- **协作**：Hocuspocus + Yjs
- **AI**：Vercel AI SDK v6，支持 OpenAI / OpenAI-Compatible / Gemini / Ollama
- **AI Agent**：Python 3.11+（Docker 默认 3.12）+ FastAPI + PydanticAI Orchestrator + Docling + Tavily + Firecrawl + Pillow

## 企业功能开源化

本项目已完成 EE 模块的后端实现和前端门控移除，详细文档：

- **[重构细节](docs/ee-refactor-details.md)**：新建/修改文件清单、设计决策、环境变量配置
- **[踩坑记录](docs/ee-refactor-pitfalls.md)**：TypeScript 编译、数据库迁移、PostgreSQL 扩展、AI SDK 行为等问题及解决方案

## Wiki × Docmost 深度集成

VitePress 知识库（`wiki/`）已深度集成 Docmost，作为公开只读前端。详细文档：

- **[集成细节](docs/wiki-integration-details.md)**：架构设计、API 端点、新建/修改文件清单、数据流、部署方案
- **[踩坑记录](docs/wiki-integration-pitfalls.md)**：VitePress 路由拦截、CORS、SSR 兼容、Vue 响应式、API 响应格式等问题及解决方案

## AI 提示词与模板管理

三层覆盖架构（系统默认 → 管理员工作区级 → 用户个人级），详细文档：

- **[模板管理重构细节](docs/ai-template-management.md)**：架构设计、权限模型、数据库设计、API 端点、文件清单、踩坑记录

## AI Agent 智能体

当前运行时是独立 Python 微服务（`agent-service/`），由 `DocumentTaskEngine` + `OrchestratorEngine` 组成，NestJS 通过 `/api/agent/*` 代理到 FastAPI。当前实现已经不是 LangGraph 图运行时。

建议按以下优先级阅读：

- **[当前架构说明](agent-service/ARCHITECTURE.md)**：当前 PydanticAI 编排器、工作流分支、事件协议、会话与草稿接口
- **[历史开发记录](docs/ai-agent-refactor-details.md)**：2026-03-04 的 LangGraph 方案，仅保留开发背景和踩坑记录
- **[历史架构设计](docs/plans/2026-03-03-ai-agent-architecture-design.md)**：当时的设计方案

当前已验证的关键约束：

- NestJS 网关使用 `http.request` 代理 SSE，而不是 `fetch`
- Agent 事件通过 `asyncio.Queue` 推送到 SSE 流
- `agent-service/app/config.py` 会优先读取根目录 `../.env`
- `AGENT_SERVICE_URL` 与 `DOCMOST_INTERNAL_URL` 支持从端口配置派生

## Docker 部署与环境管理

支持手动启动和 Docker 两种模式，通过 `setup.sh` / `setup.bat` + `dev` / `prod` 参数切换。详细文档：

- **[Docker 部署设计](docs/superpowers/specs/2026-03-23-docker-setup-restructure-design.md)**：文件结构、服务矩阵、Override 模式、地址兼容方案

## 端口统一配置

所有服务端口由 `.env` 文件顶部的 4 个核心变量集中管控，URL 由代码自动派生：

| 变量 | 默认值 | 服务 |
|------|--------|------|
| `PORT` | `3000` | Docmost NestJS 主服务 |
| `VITE_PORT` | `5173` | React 前端 Vite 开发服务器 |
| `WIKI_PORT` | `5175` | Wiki VitePress |
| `AGENT_PORT` | `8100` | Agent Service |

修改端口只需改端口变量，以下 URL 会自动派生或回退：

- `APP_URL` ← `PORT`（`apps/server/src/integrations/environment/environment.service.ts`）
- `WIKI_URL` / `VITE_WIKI_URL` ← `WIKI_PORT`
- `AGENT_SERVICE_URL` ← `AGENT_PORT`
- `DOCMOST_INTERNAL_URL` ← `PORT`（`agent-service/app/config.py`）

生产环境必须显式设置域名 URL，不能只依赖端口推导。

## 开发环境启动

### 方式一：手动启动

```bash
# 安装依赖
pnpm install

# 启动前端 + NestJS
pnpm dev

# 启动 Agent Service（单独终端）
cd agent-service
pip install -e ".[dev]"
python run.py

# 启动 Wiki（可选）
cd wiki
pnpm install
pnpm docs:dev
```

### 方式二：Docker

```bash
# 开发环境
./setup.sh dev
setup.bat dev

# 日志
./setup.sh dev logs

# 停止
./setup.sh dev down
```

### 生产环境

```bash
./setup.sh prod
setup.bat prod
```

Docker 文件结构：

- `docker-compose.yml`：基础层（Redis + 网络）
- `docker-compose.dev.yml`：开发覆盖层（volume mount + 热重载）
- `docker-compose.prod.yml`：生产覆盖层（构建镜像 + nginx Wiki）
- `docker/`：开发 / 生产用 Dockerfile 与 nginx 配置

## PostgreSQL 扩展依赖

运行本项目需要以下 PostgreSQL 扩展：

- `unaccent`：全文搜索去重音
- `pg_trgm`：模糊搜索
- `vector`（pgvector）：AI 语义搜索向量存储

如使用非标准安装的 PostgreSQL（如宝塔面板），需手动编译安装 contrib 和 pgvector，详见相关踩坑文档。

## EE 模块关键约束

EE 服务通过 `require()` 动态加载，导出类名必须精确匹配：

- `LicenseService`：被 `license-check.service.ts` 动态加载
- `ApiKeyService`：被 `jwt.strategy.ts` 通过 `ModuleRef` 获取
- `MfaService`：被 `auth.controller.ts` 通过 `ModuleRef` 获取

## 全局约定

- 所有 API 使用 `/api` 前缀
- 主键使用 UUID v7
- 软删除使用 `deletedAt` 字段
- 列表查询使用游标分页（`executeWithCursorPagination`）
- Repository 方法支持 `trx` 事务参数
