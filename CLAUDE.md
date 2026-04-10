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

## AI Agent 智能体（康康写作）

V1 Orchestrator 已于 2026-03-30 完整移除（-37,000 行），当前仅保留 V2 Intelligent Agent。

### 架构

PydanticAI 双 Agent（Creation + Editing）+ 5 工具 + 选区编辑 + Redis 会话。

- **Python 端点**：`POST /agent/v2/run`（`agent-service/app/main.py`）
- **NestJS 代理**：`POST /api/agent/v2/run`（`agent-gateway.controller.ts`）
- **LLM 工厂**：`app/llm/factory.py`（支持 OpenAI / Gemini / Ollama / OpenAI-compatible）
- **前端面板**：`apps/client/src/ee/ai/components/agent-panel/`（品牌名"康康写作"，i18n key: `Smart Writer`）

### 关键文件

| 文件 | 作用 |
|------|------|
| `agent-service/app/main.py` | FastAPI 入口，`/agent/v2/run` + `/agent/stop` + `/agent/web-search` |
| `agent-service/app/agent/runner.py` | Agent 执行引擎，SSE 事件流 |
| `agent-service/app/agent/agent.py` | PydanticAI Agent 双单例（creation / editing） |
| `agent-service/app/agent/skill_router.py` | 基于 selection / history / files 路由到 creation 或 editing |
| `agent-service/app/agent/skills/` | creation.py（思考框架）+ editing.py（保真框架 + `<document>` 标记）+ shared.py（格式规则） |
| `agent-service/app/agent/tools/` | 5 工具：extract_document, describe_images, scrape_url, search_web, read_page |
| `agent-service/app/agent/conversation_store.py` | Redis 多轮会话存储（滑动窗口 6 轮，24h TTL） |
| `agent-service/app/llm/factory.py` | PydanticAI 模型实例工厂 |
| `apps/server/src/ee/ai/agent-gateway/` | NestJS SSE 代理 + 并发限制 + 会话鉴权 |
| `apps/client/src/ee/ai/components/agent-panel/` | 前端面板（时间线消息、选区编辑、文件上传/粘贴） |
| `apps/client/src/ee/ai/utils/safe-apply.ts` | TipTap 原生命令 Apply + 快照回退 |
| `apps/client/src/ee/ai/utils/markdown-utils.ts` | 共享 markdown 工具（extractTitle, preprocessImages, maybeExtractTitle） |

### 设计文档（历史参考）

- **[v2 Agent 模块说明](agent-service/app/agent/README.md)**：架构、工具集、SSE 事件协议
- **[Phase 1-3 实施总结](docs/superpowers/plans/2026-03-27-intelligent-agent-implementation-summary.md)**：核心 Agent + 前端 + 文档智能
- **[多轮增强计划](docs/superpowers/plans/2026-03-28-agent-multi-turn-enhancement.md)**：Redis 会话 + Skill 拆分 + 输出分类
- **[选区编辑设计](docs/superpowers/specs/2026-03-28-selection-editing-and-apply-safety.md)**：三模式编辑 + Apply 安全
- **[历史开发记录](docs/ai-agent-refactor-details.md)**：LangGraph → PydanticAI 重构历史（V1 已移除）

### 关键设计决策

- 双 Agent singleton：`skill_router.py` 基于 has_selection / has_message_history / has_files 路由
- 选区快照存入 userMessage（不可变），Apply 从消息读取（不是实时 state）
- REPLACE 模式 fail-closed（验证失败拒绝应用），INSERT 模式宽松（只检查范围）
- 输出分类：选区/插入模式强制 document，全文模式启发式判断
- V2 取消链路：session 事件含 task_id，cancel 调用 /agent/stop

### 约束

- NestJS 网关使用 `http.request` 代理 SSE，而不是 `fetch`
- `agent-service/app/config.py` 会优先读取根目录 `../.env`
- `AGENT_SERVICE_URL` 与 `DOCMOST_INTERNAL_URL` 支持从端口配置派生
- `AGENT_MAX_TOOL_CALLS` 环境变量控制工具调用上限（默认 10）
- 前端输入框支持粘贴图片（自动添加到文件列表）

## 层级权限系统（Space → Directory → Page）

三级权限模型，使用统一 `resource_permissions` 覆盖表 + `ResourceAbilityFactory` 三级解析链。

### 核心概念

- **Space 级**：`space_members` 表，角色 ADMIN/WRITER/READER/NONE
- **Directory/Page 级**：`resource_permissions` 表，就近覆盖
- **NONE 角色**：在 space 级表示"受限访问"（可进入空间但默认无内容权限），在 resource 级表示"显式拒绝"
- **解析链**：page override → directory override → space_members fallback

### 关键文件

| 文件 | 作用 |
|------|------|
| `resource-ability.factory.ts` | 三级权限解析引擎 |
| `space-ability.factory.ts` | Space 级能力工厂（含 buildRestrictedAbility / buildNoneAbility） |
| `resource-permission.repo.ts` | 数据访问层（CRUD + getUserOverridesInSpace + findHiddenForPublic） |
| `resource-permission.controller.ts` | CRUD API（list/add/update/remove） |
| `resource-permission.service.ts` | 业务逻辑 + 事件监听 + 自动添加 space 成员 |
| `resource-permission-modal.tsx` | 前端权限管理弹窗（3列布局：成员+类型badge / 角色 / 删除） |
| `settings-modal.tsx` | 空间设置弹窗（4 tabs：设置/成员/目录/主题，统一 panelStyle） |
| `space-members.tsx` | 成员列表（搜索+添加同行、直接删除图标替代 ... 菜单） |
| `directory-list.tsx` | 目录列表（hover 显示操作按钮、Code slug 样式） |
| `topic-list.tsx` | 主题列表（与目录列表交互模式一致） |

### 关键设计决策

- 就近覆盖（不是只能缩小）：子级设置什么就是什么
- None 优先规则：同层级有任何 none 记录 → 直接拒绝
- Space 级 NONE 用 `buildRestrictedAbility`（有 Read），Resource 级 NONE 用 `buildNoneAbility`（空权限）
- 侧边栏双模式过滤：restricted 用户加法模式 + 普通用户减法模式
- 设置 resource_permission 时自动添加目标用户为空间 NONE 成员
- page info API 返回 `effectiveRole`，前端据此控制 UI

### 设计文档

- **[设计 Spec](docs/superpowers/specs/2026-04-09-hierarchical-permission-system-design.md)**
- **[实施计划](docs/superpowers/plans/2026-04-09-hierarchical-permission-implementation.md)**

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
- `pg_jieba`（可选）：中文分词，安装后搜索和 RAG 自动启用双语 jiebacfg 分词

如使用非标准安装的 PostgreSQL（如宝塔面板），需手动编译安装 contrib、pgvector 和 pg_jieba，详见相关踩坑文档。

## RAG 向量检索架构（2026-03-30 升级后）

多路混合检索管道：实体抽取 + 多 Facet 并行搜索 + HyDE/CRAG 自适应重试 + 五档置信度 + 上下文标注 + 分层 Prompt + 消歧拦截。

### 关键文件

- 分块：`apps/server/src/ee/ai/utils/chunker.ts`（Markdown 标题感知 + sectionHeading 传递 + 1600 字符递归 + 20% overlap）
- Embedding 管道：`apps/server/src/ee/ai/ai-queue.processor.ts`（BullMQ 异步，structural context = 空间名+页面标题+章节名+文档摘要）
- 查询理解：`apps/server/src/ee/ai/services/query-understanding.service.ts`（intent + complexity + entities + searchFacets）
- 搜索服务：`apps/server/src/ee/ai/services/ai-search.service.ts`（多路 Facet 搜索、HyDE、CRAG、上下文标注、消歧拦截、normalizedScore）
- 置信度评估：`apps/server/src/ee/ai/services/retrieval-quality.service.ts`（五档：exact/high/partial/tangential/none + entityCoverage）
- Prompt 架构：`apps/server/src/ee/ai/utils/intent-prompts.ts`（Role → Formatting Standard → Strategy → Output Structure → Constraints → SelfCheck）
- 完整性检查：`apps/server/src/ee/ai/services/answer-verifier.service.ts`（groundedness + completeness）
- Token 预算：`apps/server/src/ee/ai/utils/token-budget.ts`
- 上下文投影：`apps/server/src/common/helpers/prosemirror/content-projection.ts`
- 图片提取：`apps/server/src/ee/ai/utils/content-extractor.ts`
- 引用上标渲染：`wiki/docs/.vitepress/theme/utils/markdown.ts`（引用 [N] 上标渲染）

### 关键约束

- `page_embeddings` 表通过 `ai-queue.processor.ts` 动态创建（非迁移文件）
- HNSW 索引参数 m=16, ef_construction=200；查询时 SET LOCAL hnsw.ef_search=100（需在事务内）
- 图片节点必须有 `attachmentId`：`persistence.extension.ts` 的 `ensureImageAttachmentIds()` 在保存时从 src URL 提取
- jiebacfg 搜索通过 `checkJiebaAvailable()` 条件启用（pg_jieba 未安装时自动回退到 English-only）
- Wiki 公共 AI 问答用完整 JWT 签名 URL（不可用短 URL 替代，LLM 不保证原样输出 URL）
- Adaptive 策略：HyDE（normalizedScore < 0.008）、CRAG（partial/tangential + entityCoverage < 0.5）、上下文标注（partial/tangential）——好查询零额外开销
- 消歧最多 1 轮追问，通过 `{ disambiguation: true }` SSE 事件 + `isDisambiguation` flag 追踪
- 全量重建：`rebuild-all-embeddings` BullMQ job，BATCH_SIZE=5 并发
- Prompt 排版规范：加粗结论独立成段、段落最多 2 句、操作路径用代码格式、警告独立成段、列表化、每种 confidence×intent 有视觉模板
- Answer confidence 模型：当 currentPage 有内容时，retrieval confidence 为 none/tangential 会升级为 partial，确保不会在有上下文时拒绝回答
- Pipeline 并行：查询理解与初始检索并行执行，exact/high 跳过 groundedness 验证
- Prompt 风格：自然对话式，引用 [N] 只标关键来源，不每句都标；鼓励善用 markdown（代码块、表格、引用）
- 图片上下文：检索 chunk 使用 ProseMirror 渲染（buildContextText）保留图片在原文位置，不再末尾追加
- Sources 过滤：前端 AIChatSources 过滤 image/diagram 类型，只显示 page/attachment/web

### 设计文档

- **[质量升级设计 Spec](docs/superpowers/specs/2026-03-30-wiki-qa-quality-upgrade-design.md)**：4 模块完整架构（索引→查询→衔接→生成）
- **[P0-P2 关键改进计划](docs/superpowers/plans/2026-03-30-wiki-qa-critical-improvements.md)**：13 项安全/质量/体验修复
- **[全面升级计划](docs/superpowers/plans/2026-03-30-wiki-qa-quality-upgrade.md)**：12 Task 五阶段实施
- **[UX 大修实施计划](docs/superpowers/plans/2026-03-30-wiki-qa-ux-overhaul.md)**：自然对话式 Prompt + Pipeline 提速 + 引用上标 + Answer confidence 模型

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
