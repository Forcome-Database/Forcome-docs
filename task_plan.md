# 任务计划

## 目标

深入理解 Docmost 当前仓库中的数据库架构来源、迁移机制、环境变量装配方式，以及 `.env.dev` / `.env.prod` 对 PostgreSQL 的影响，给出一套“只迁移数据库架构、不保留任何业务数据”的安全方案。

## 阶段

| 状态 | 阶段 | 说明 |
|------|------|------|
| completed | 1. 仓库勘察 | 已确认 NestJS + Kysely + PostgreSQL，迁移文件位于 `apps/server/src/database/migrations` |
| completed | 2. 环境对比 | 已确认 `.env.dev` / `.env.prod` 在 Docker 中可切换，但应用代码本身默认只读取根目录 `.env` |
| completed | 3. 架构迁移链路 | 已确认 schema 主要由 migration 生成，`page_embeddings` 为运行期按需动态建表，初始租户数据由 `/api/auth/setup` 创建 |
| completed | 4. 输出方案 | 已补充一键 PowerShell 入口、可测试的 TypeScript 执行核心与验证说明 |

## 当前假设

- 项目主数据库是 PostgreSQL。
- 数据库 schema 的可信来源应是代码仓库内的迁移文件，而不是直接复制生产或开发环境数据库文件。
- 用户要的是把开发环境数据库“结构”平移到生产数据库，而不是同步内容数据。

## 风险与关注点

- 如果项目依赖运行时 seed 数据或默认系统记录，仅执行迁移可能得到“结构完整但系统不可启动”的库，需要核实。
- 如果 `.env.prod` 指向已存在数据库，必须先清空目标库对象，否则会残留旧结构或旧数据。
- PostgreSQL 扩展（如 `pgvector`、`pg_trgm`、`unaccent`）若未先安装，会导致迁移失败。

## 错误记录

暂无。
