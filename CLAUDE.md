# Docmost 项目指南

## 项目简介
Docmost v0.25.3 — 开源协作文档管理系统（类 Notion/Confluence），基于 AGPL 3.0 许可证。

## 技术栈
- **后端**：NestJS 11 + Fastify + Kysely（PostgreSQL） + Redis + BullMQ
- **前端**：React 18 + TypeScript + Vite + Mantine + TipTap
- **协作**：Hocuspocus + Yjs
- **AI**：Vercel AI SDK v6，支持 OpenAI / OpenAI-Compatible / Gemini / Ollama

## 企业功能开源化

本项目已完成 EE 模块的后端实现和前端门控移除，详细文档：

- **[重构细节](docs/ee-refactor-details.md)** — 新建/修改文件清单、设计决策、环境变量配置
- **[踩坑记录](docs/ee-refactor-pitfalls.md)** — TypeScript 编译、数据库迁移、PostgreSQL 扩展、AI SDK 行为等问题及解决方案

## 开发环境启动

```bash
# 安装依赖
pnpm install

# 配置 .env（参考 .env.example）
# 关键项：DATABASE_URL, REDIS_URL, APP_SECRET, AI 配置

# 启动开发服务器
pnpm dev
```

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
