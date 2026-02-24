# Docmost 企业功能开源化 — 踩坑记录

## 1. TypeScript 编译错误

### 1.1 AI SDK v6 Usage 类型不匹配
**现象**：`result.usage.promptTokens` 报 property does not exist
**原因**：AI SDK v6 的 `LanguageModelUsage` 使用 `inputTokens` / `outputTokens`，而非 v5 的 `promptTokens` / `completionTokens`
**修复**：
```typescript
// 错误
promptTokens: result.usage.promptTokens,
// 正确
promptTokens: result.usage.inputTokens ?? 0,
```

### 1.2 catch 块 error 类型
**现象**：`error.message` on `unknown` type
**修复**：`catch (error: any)`

### 1.3 未使用的依赖注入
**现象**：MfaService 注入了 AuthService 但未使用，导致循环依赖风险
**修复**：移除未使用的 AuthService 注入，密码验证直接使用 `comparePasswordHash` 工具函数

---

## 2. 数据库与迁移

### 2.1 开发模式不运行迁移
**现象**：`relation "workspaces" does not exist`
**原因**：`database.module.ts` 中迁移代码被 `NODE_ENV === 'production'` 条件包裹，而 `pnpm dev` 的 `start:dev` 脚本强制设置 `NODE_ENV=development`
**修复**：移除 NODE_ENV 条件判断，始终运行迁移
```typescript
// 修改前
if (this.environmentService.getNodeEnv() === 'production') {
  await this.migrationService.migrateToLatest();
}
// 修改后
await this.migrationService.migrateToLatest();
```

### 2.2 PostgreSQL 扩展缺失（unaccent / pg_trgm）
**现象**：迁移失败，提示 unaccent 扩展不存在
**原因**：宝塔面板安装的 PostgreSQL 18 未包含 contrib 模块
**修复**：从 PostgreSQL 18 源码编译 contrib 扩展：
```bash
cd /tmp && wget https://ftp.postgresql.org/pub/source/v18.0/postgresql-18.0.tar.gz
tar xzf postgresql-18.0.tar.gz && cd postgresql-18.0
./configure --prefix=/www/server/pgsql --without-readline
cd contrib/unaccent && make && make install
cd ../pg_trgm && make && make install
# 在数据库中创建
psql -U postgres -d docmost -c "CREATE EXTENSION IF NOT EXISTS unaccent;"
psql -U postgres -d docmost -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### 2.3 pgvector 扩展版本不兼容
**现象**：编译 pgvector v0.8.0 时报错 `too few arguments to function 'vacuum_delay_point'`
**原因**：PostgreSQL 18 修改了 `vacuum_delay_point()` 函数签名，pgvector v0.8.0 不兼容
**修复**：使用 pgvector master 分支（兼容 PG 18）：
```bash
git clone https://github.com/pgvector/pgvector.git
cd pgvector
export PG_CONFIG=/www/server/pgsql/bin/pg_config
make && make install
psql -U postgres -d docmost -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 2.4 AI Search "鸡生蛋"问题
**现象**：开启 AI Search 时提示 "Failed to activate. Make sure pgvector postgres extension is installed."
**原因**：`workspace.service.ts` 检查 `page_embeddings` 表是否存在，但该表的创建逻辑在检查通过后的队列任务中
**修复**：将检查逻辑改为尝试创建 pgvector 扩展：
```typescript
// 修改前：检查表
const tableExists = await isPageEmbeddingsTableExists(this.db);
if (!tableExists) throw new BadRequestException('...');

// 修改后：检查扩展
try {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(this.db);
} catch {
  throw new BadRequestException('...');
}
```

---

## 3. 基础设施

### 3.1 APP_SECRET 占位符
**现象**：启动报错 `APP_SECRET must be longer than or equal to 32 characters`
**修复**：在 `.env` 中设置真实的 32+ 字符密钥：`openssl rand -hex 32`

### 3.2 Redis 认证失败
**现象**：`NOAUTH Authentication required`
**原因**：Redis 设置了密码但 `.env` 中 `REDIS_URL` 未包含密码
**修复**：`REDIS_URL=redis://:PASSWORD@HOST:6379`（注意冒号前为空，表示无用户名）

### 3.3 PostgreSQL 连接被拒
**现象**：`pg_hba.conf rejects connection`
**修复**：在 PostgreSQL 服务器的 `pg_hba.conf` 中添加客户端 IP 允许规则：
```
host    all    all    CLIENT_IP/32    md5
```

---

## 4. AI 功能

### 4.1 AI SDK streamText 不抛异常
**现象**：API 返回 401 错误，但 `for await (const chunk of result.textStream)` 不抛异常，循环以 0 chunks 正常结束
**原因**：AI SDK v6 的 `streamText` 在 API 错误时将错误打印到 stderr，但 `textStream` 迭代器静默结束而非抛出
**影响**：try/catch 无法捕获错误，前端收到空流 + `[DONE]`
**建议**：在流结束后检查 chunk 数量，如果为 0 则返回错误信息

### 4.2 系统环境变量覆盖 .env
**现象**：`.env` 中 `OPENAI_API_KEY` 正确，但服务读到的是占位符 `YOUR_KEY_HERE`
**原因**：Windows 系统环境变量中已设置 `OPENAI_API_KEY=YOUR_KEY_HERE`，`process.env` 优先级高于 `.env` 文件
**修复方案**：
- 方案 A（推荐）：删除 Windows 系统环境变量中的 `OPENAI_API_KEY`
- 方案 B：启动前在终端覆盖：
  - PowerShell: `$env:OPENAI_API_KEY="sk-xxx"`
  - Bash: `export OPENAI_API_KEY=sk-xxx`

### 4.3 缺少 AI 队列处理器
**现象**：开启 AI Search 后 page_embeddings 表不会被创建，嵌入也不会生成
**原因**：EE 模块中缺少 `AiQueueProcessor`，队列任务 `WORKSPACE_CREATE_EMBEDDINGS` / `GENERATE_PAGE_EMBEDDINGS` 等无人消费
**修复**：创建 `ai-queue.processor.ts`，处理所有 AI 相关队列任务，包括：
- 创建 pgvector 扩展和 page_embeddings 表
- 为整个工作区生成嵌入
- 单页嵌入的增删改

---

## 5. 调试技巧

### 5.1 NestJS 开发模式日志
在 service 和 controller 中添加 `Logger` 进行分级日志输出，方便追踪请求链路：
```typescript
private readonly logger = new Logger(ClassName.name);
this.logger.debug('message');  // 仅 debug 级别
this.logger.log('message');    // info 级别
this.logger.error('message');  // error 级别
```

### 5.2 环境变量排查
当 `.env` 值与运行时不一致时，同时检查 `configService.get()` 和 `process.env`：
```typescript
const fromConfig = this.configService.get('KEY');
const fromEnv = process.env.KEY;
// 如果两者不同，说明有覆盖源
```

### 5.3 PostgreSQL 扩展检查
```sql
SELECT * FROM pg_available_extensions WHERE name IN ('vector', 'unaccent', 'pg_trgm');
SELECT * FROM pg_extension;
```
