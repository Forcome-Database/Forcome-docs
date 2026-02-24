# Docmost 企业功能开源化 — 重构细节

## 概述

将 Docmost 企业版（EE）中 API 密钥、MFA、AI 三个模块的后端服务完整实现，并移除前端许可证门控，使开源版本可直接使用这些功能。

## 技术背景

- 框架：NestJS 11 + Fastify
- ORM：Kysely 0.28.2（类型安全 SQL 构建器）
- 数据库：PostgreSQL 18
- 缓存/队列：Redis 8 + BullMQ 5.65.0
- AI SDK：Vercel AI SDK v6（`ai` 包）
- EE 模块通过运行时 `require('./ee/ee.module')` 动态加载

## 新建文件清单（共 19 个）

### Phase 1: 基础框架
| 文件 | 说明 |
|------|------|
| `apps/server/src/ee/ee.module.ts` | EE 顶层模块，导入所有子模块 |
| `apps/server/src/ee/licence/license.module.ts` | 许可证模块 |
| `apps/server/src/ee/licence/license.service.ts` | 许可证服务，`isValidEELicense()` 始终返回 `true` |

### Phase 2: API 密钥模块
| 文件 | 说明 |
|------|------|
| `apps/server/src/ee/api-key/api-key.repo.ts` | API Key 数据仓库，支持游标分页和 creator JOIN 查询 |
| `apps/server/src/ee/api-key/api-key.service.ts` | API Key 服务（类名必须为 `ApiKeyService`，被 jwt.strategy.ts 动态 require） |
| `apps/server/src/ee/api-key/api-key.controller.ts` | 4 个 POST 端点：list / create / update / revoke |
| `apps/server/src/ee/api-key/dto/api-key.dto.ts` | DTO 验证类 |
| `apps/server/src/ee/api-key/api-key.module.ts` | 模块定义，导入 TokenModule，导出 ApiKeyService |

### Phase 3: MFA 模块
| 文件 | 说明 |
|------|------|
| `apps/server/src/ee/mfa/mfa.repo.ts` | user_mfa 表 CRUD |
| `apps/server/src/ee/mfa/services/mfa.service.ts` | MFA 服务（类名必须为 `MfaService`，被 auth.controller.ts 动态 require） |
| `apps/server/src/ee/mfa/mfa.controller.ts` | 7 个 POST 端点：status / setup / enable / disable / verify / generate-backup-codes / validate-access |
| `apps/server/src/ee/mfa/dto/mfa.dto.ts` | MFA DTO 验证类 |
| `apps/server/src/ee/mfa/mfa.module.ts` | 模块定义，导入 TokenModule，导出 MfaService |

### Phase 4: AI 模块
| 文件 | 说明 |
|------|------|
| `apps/server/src/ee/ai/services/ai.service.ts` | AI 文本生成服务，支持 4 种驱动（openai / openai-compatible / gemini / ollama） |
| `apps/server/src/ee/ai/services/ai-search.service.ts` | AI 语义搜索服务，使用 pgvector 向量检索 + RAG 流式回答 |
| `apps/server/src/ee/ai/ai.controller.ts` | 3 个端点：generate / generate/stream（SSE）/ answers（SSE） |
| `apps/server/src/ee/ai/dto/ai.dto.ts` | AI DTO，包含 AiAction 枚举和验证类 |
| `apps/server/src/ee/ai/ai.module.ts` | AI 模块定义 |
| `apps/server/src/ee/ai/ai-queue.processor.ts` | AI 队列处理器，负责创建 page_embeddings 表和生成/删除嵌入 |

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `apps/client/src/ee/hooks/use-enterprise-access.tsx` | 始终返回 `true`，移除许可证门控 |
| `apps/client/src/ee/hooks/use-license.tsx` | `hasLicenseKey` 始终返回 `true` |
| `apps/server/src/database/database.module.ts` | 移除 `NODE_ENV === 'production'` 迁移条件，开发模式也运行迁移 |
| `apps/server/src/core/workspace/services/workspace.service.ts` | AI Search 启用逻辑：先创建 pgvector 扩展再检查，而非检查表是否存在 |

## 关键设计决策

### 1. 动态加载模式
EE 模块通过 `require()` 动态加载，类名必须精确匹配：
- `LicenseService` — 被 `license-check.service.ts` require
- `ApiKeyService` — 被 `jwt.strategy.ts` 通过 ModuleRef 获取
- `MfaService` — 被 `auth.controller.ts` 通过 ModuleRef 获取

### 2. AI SDK v6 适配
- 使用 `generateText` / `streamText` 而非旧版 API
- Usage 字段使用 `inputTokens` / `outputTokens`（非 v5 的 `promptTokens` / `completionTokens`）
- `streamText` 在 API 错误时不抛异常，而是结束流并打印到 stderr

### 3. AI Search 的"鸡生蛋"问题
原始逻辑：开启 AI Search → 检查 page_embeddings 表是否存在 → 表不存在则报错。
但表的创建恰好在检查通过后的队列任务中。
修复：改为检查 pgvector 扩展是否可创建，表的创建交给队列处理器。

### 4. 游标分页
所有列表查询使用 `executeWithCursorPagination`（非 offset 分页），与项目现有模式一致。

### 5. SSE 流式响应
AI 流式响应使用 Server-Sent Events 格式：
```
data: {"content":"chunk text"}\n\n
data: [DONE]\n\n
```
通过 `res.raw.writeHead()` + `res.raw.write()` 直接操作 Fastify 底层 HTTP 响应。

## 环境变量配置

```env
# AI 配置
AI_DRIVER=openai-compatible          # openai | openai-compatible | gemini | ollama
AI_COMPLETION_MODEL=gpt-4o           # 补全模型名称
AI_EMBEDDING_MODEL=text-embedding-3-small  # 嵌入模型名称
AI_EMBEDDING_DIMENSION=1536          # 嵌入维度
OPENAI_API_KEY=sk-xxx                # API Key
OPENAI_API_URL=https://api.xxx.com/v1  # 自定义 API URL（openai-compatible 必填）
```
