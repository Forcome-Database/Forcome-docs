# 进度日志

## 2026-03-24

- 已读取 `using-superpowers` 与 `planning-with-files` 技能说明。
- 已读取仓库根目录列表，确认 env、docker、apps、packages、agent-service 等核心目录存在。
- 已读取 `CLAUDE.md`，确认数据库类型、关键扩展与部署方式。
- 已初始化本次会话的计划、发现和进度文件，准备继续勘察数据库迁移入口与环境变量装配。
- 已确认应用启动自动执行数据库迁移，且命令行迁移脚本与运行时配置默认读取根目录 `.env`。
- 已确认 `.env.dev` 与 `.env.prod` 当前数据库目标相同，存在误把“开发/生产”当成两套独立库的高风险。
- 已确认 migration 不负责创建管理员/工作区等业务初始数据；空库 schema 完整后仍需首次 setup 才能形成可登录租户。
- 正在整理最终说明：推荐迁移路径、避免残留数据的方法、以及 AI 搜索场景下的补充动作。
- 已确定实现策略：新增一套可测试的 TypeScript schema-only 迁移核心逻辑，并提供 PowerShell 包装脚本作为一键入口。
- 已核对最新环境变量：`.env.dev` 指向 `docmost`，`.env.prod` 指向 `forcomedocs_prod`，数据库隔离前提成立。
- 已按 TDD 先写失败测试，再实现 `schema-only-migration.utils.ts` 与 `schema-only-migration.ts`。
- 已新增 `scripts/migrate-schema-only.ps1` 和根脚本 `db:schema:prod`。
- 已验证：
- `pnpm --filter ./apps/server exec jest src/database/schema-only-migration.utils.spec.ts src/database/schema-only-migration.spec.ts --runInBand` 通过（7 个测试全部通过）。
- `package.json` 语法检查通过。
- PowerShell 脚本经过静态解析，未发现语法错误。
- 用户反馈真实运行时连接 `postgres` 维护库被 `pg_hba.conf` 拒绝；已按系统化调试定位根因为维护库选择问题。
- 已新增回退测试并实现自动回退逻辑；最新验证结果为 `8` 个测试全部通过。
- 已继续定位真实环境偏差：维护库错误发生在惰性建连后的首条 SQL，而不是 client 创建时。
- 已新增对应回归测试，并将维护库回退逻辑移动到真正执行 reset SQL 的层级。
- 已新增 TLS 握手失败的清晰提示测试与实现。
- 最新验证结果：
- `pnpm --filter ./apps/server exec jest src/database/schema-only-migration.utils.spec.ts src/database/schema-only-migration.spec.ts --runInBand` 通过（10 个测试全部通过）。
