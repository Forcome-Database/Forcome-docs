# 发现记录

## 2026-03-24

- 仓库根目录存在 `.env.dev`、`.env.prod`、`docker-compose.dev.yml`、`docker-compose.prod.yml`，说明开发与生产环境均通过独立 env 文件驱动。
- `CLAUDE.md` 明确项目技术栈为 NestJS 11 + Kysely + PostgreSQL + Redis。
- `CLAUDE.md` 明确项目依赖 PostgreSQL 扩展：`unaccent`、`pg_trgm`、`vector(pgvector)`。
- 当前任务重点不是“迁移数据”，而是确认如何在 `.env.prod` 指向的目标库中构造一份完整、可运行、无业务残留数据的 schema。
- `apps/server/src/database/database.module.ts` 在应用启动时总是执行 `migrateToLatest()`，因此启动服务会自动把数据库迁移到最新版本。
- `apps/server/src/database/migrate.ts` 和 `apps/server/src/integrations/environment/environment.module.ts` 都通过 `envPath` 读取根目录固定文件 `.env`，不是自动读取 `.env.dev` / `.env.prod`。
- `setup.sh` / `setup.bat` 与 `docker-compose.*.yml` 仅在 Docker Compose 层通过 `--env-file .env.<mode>` 选择环境；CLI 直跑迁移与 Docker 启动的环境来源不同。
- `.env.dev` 与 `.env.prod` 当前 `DATABASE_URL` 指向同一 PostgreSQL 主机、同一端口、同一数据库名、同一 schema；这意味着它们并不是天然隔离的“开发库”和“生产库”。
- 迁移文件没有给业务表写入固定 seed 数据；工作区、默认空间、管理员用户等是在首次调用 `/api/auth/setup` 时由业务逻辑创建。
- `page_embeddings` 不在迁移文件里创建，而是由 `apps/server/src/ee/ai/ai-queue.processor.ts` 在启用 AI Search 或相关队列任务执行时动态创建。
- 迁移体系会创建业务表、索引、函数、触发器以及 Kysely 自身的迁移元数据表；其中迁移元数据表不应视为“残留脏数据”。
- 仓库已有 Jest/ts-jest 测试基础设施，`apps/server/src/**/*.spec.ts` 是现成测试落点，适合为新的 schema 迁移辅助逻辑先写单测。
- 为避免引入 `psql` 外部依赖，最合适的实现是：PowerShell 只做一键入口，核心逻辑在 TypeScript 中直接使用现有 `postgres` + `kysely` 依赖完成“连接维护库 → 删除并重建目标库 → 执行 migrateToLatest”。
- 由于 `.env.dev` 和 `.env.prod` 当前仍指向同一数据库，脚本必须内置硬性保护：当两者 host/port/database/schema 相同就拒绝执行，防止误删开发库或共用库。
- 用户已将 `.env.prod` 的 `DATABASE_URL` 修改为 `forcomedocs_prod`，当前 dev/prod 已指向同一实例上的不同数据库名，满足安全执行前提。
- 新增的执行核心位于 `apps/server/src/database/schema-only-migration.ts`，会按顺序执行：读取 `.env.dev/.env.prod` → 拒绝同库配置 → 连接维护库 → 终止目标库连接 → `DROP DATABASE` → `CREATE DATABASE` → `migrateToLatest()`。
- 一键入口位于 `scripts/migrate-schema-only.ps1`；另补充了根脚本 `pnpm run db:schema:prod` 供非 PowerShell 场景复用。
- 为安全起见，本次只做了单测和语法验证，没有实际执行删库重建，也没有连接用户数据库做真实迁移。
- 用户真实执行时出现 `no pg_hba.conf entry ... database "postgres", no encryption`，根因是脚本默认连接的维护库 `postgres` 在该服务器上不可达；失败发生在“维护库连接”阶段，不是 migration SQL 本身。
- 已将脚本增强为：当默认维护库因 `pg_hba` 连接问题不可用时，若 `.env.dev` 与 `.env.prod` 位于同一 PostgreSQL 集群，则自动回退到 dev 数据库名作为维护库连接。
- 进一步确认：`postgres.js` 为惰性建连，真实的维护库连接错误是在首条 `execute()` SQL 才抛出；此前的回退逻辑只包住 client 创建，因此在真实环境下不会生效。
- 当前 `.env.prod` 已被改成 `...forcomedocs_prod?schema=public&sslmode=require`。这会强制 TLS，而当前 PostgreSQL 服务端显然没有成功完成 TLS 握手，因此报错变为 `Client network socket disconnected before secure TLS connection was established`。
- 用户提供的 `pg_hba.conf` 里虽然有 `host forcomedocs_prod postgres ...`，但这只匹配“连接数据库 forcomedocs_prod、用户 postgres”；最初报错针对的是“连接数据库 postgres、用户 postgres”，所以这条规则并不匹配。
- 现在脚本已同时覆盖两类场景：
- 维护库在首条 SQL 时才暴露 `pg_hba` 错误时，也能正确回退到 dev 库名。
- 当 `sslmode=require` 导致 TLS 握手失败时，会给出明确提示：移除 `sslmode=require` 或在服务端启用 SSL。
