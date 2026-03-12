# Directory/Topic 功能修复记录

> 日期：2026-03-06
> 涉及模块：目录 (Directory)、主题 (Topic)、向量嵌入 (Embeddings)

## 背景

对 Directory 和 Topic 功能进行深度审查，发现多个设计缺陷，涵盖 slug 生成、软删除、排序、向量同步等方面。本次修复解决了所有 P0 级别问题。

---

## 修复内容

### 1. Slug 生成优化（中英文混合场景）

**问题**：`@sindresorhus/slugify` 会丢弃中文等非拉丁字符。当名称首字母为英文时（如 `"A项目文档"`），slug 仅保留 `"a"`，无意义且易冲突。

**方案**：新增 `generateSlug()` 函数，当 slugify 结果不足 3 字符时自动追加 nanoId 后缀。

| 输入 | 旧 slug | 新 slug |
|------|---------|---------|
| `"My Directory"` | `"my-directory"` | `"my-directory"` (不变) |
| `"A项目文档"` | `"a"` | `"a-x7k2m9p4qt"` |
| `"项目文档"` | `"x7k2m9p4qt"` (随机) | `"x7k2m9p4qt"` (不变) |

**修改文件**：
- `apps/server/src/common/helpers/nanoid.utils.ts` — 新增 `generateSlug()`
- `apps/server/src/core/directory/directory.service.ts` — 使用 `generateSlug` 替代 `slugify || nanoIdGen`
- `apps/server/src/core/topic/topic.service.ts` — 同上

### 2. 软删除实现

**问题**：数据库迁移定义了 `deleted_at` 字段，但 Repo 层使用硬删除（`DELETE FROM`），且所有查询未过滤已删除记录。与项目全局软删除策略（Page 等实体）不一致。

**方案**：
- `deleteDirectory` / `deleteTopic` 改为 `UPDATE ... SET deletedAt = now()`
- 所有查询方法（`findById`、`slugExists`、列表查询）添加 `.where('deletedAt', 'is', null)`

**修改文件**：
- `apps/server/src/database/repos/directory/directory.repo.ts`
- `apps/server/src/database/repos/topic/topic.repo.ts`

### 3. 删除时级联处理与向量同步

**问题**：改为软删除后，数据库级别的 `ON DELETE CASCADE`（topics）和 `ON DELETE SET NULL`（pages）不再触发。同时 `page_embeddings` 表的 `directoryId`/`topicId` 不会自动清理，导致向量搜索返回脏数据。

**方案**：在 Service 层手动处理级联逻辑：

**删除 Directory 时**：
1. 查找受影响的页面 ID 列表
2. 软删除所有子 Topics
3. 清除页面的 `directoryId` 和 `topicId` 引用（SET NULL）
4. 软删除 Directory 本身
5. 发送 `PAGE_MOVED_TO_SPACE` Queue Job，触发 embeddings 的 `directoryId`/`topicId` 同步

**删除 Topic 时**：
1. 查找受影响的页面 ID 列表
2. 清除页面的 `topicId` 引用（保留 `directoryId`）
3. 软删除 Topic 本身
4. 发送 Queue Job 同步 embeddings

**修改文件**：
- `apps/server/src/core/directory/directory.service.ts` — 注入 KyselyDB + AI_QUEUE，重写 `deleteDirectory`
- `apps/server/src/core/topic/topic.service.ts` — 同上，重写 `deleteTopic`
- `apps/server/src/core/directory/directory.module.ts` — 注册 BullMQ AI_QUEUE
- `apps/server/src/core/topic/topic.module.ts` — 同上

### 4. 分页排序修正

**问题**：游标分页按 `id`（UUID）排序，无业务意义。`position` 字段（fractional-indexing）在创建时生成但查询时被忽略，用户排序无效。

**方案**：排序字段从 `[id ASC]` 改为 `[position ASC, id ASC]`。

**修改文件**：
- `apps/server/src/database/repos/directory/directory.repo.ts` — `getDirectoriesInSpace` 分页配置
- `apps/server/src/database/repos/topic/topic.repo.ts` — `getTopicsInDirectory` 分页配置

---

## 完整修改文件清单

| 文件路径 | 修改类型 |
|---------|---------|
| `apps/server/src/common/helpers/nanoid.utils.ts` | 新增函数 |
| `apps/server/src/database/repos/directory/directory.repo.ts` | 软删除 + 查询过滤 + 排序 |
| `apps/server/src/database/repos/topic/topic.repo.ts` | 软删除 + 查询过滤 + 排序 |
| `apps/server/src/core/directory/directory.service.ts` | 级联删除 + embeddings 同步 |
| `apps/server/src/core/topic/topic.service.ts` | 级联删除 + embeddings 同步 |
| `apps/server/src/core/directory/directory.module.ts` | BullMQ 依赖注册 |
| `apps/server/src/core/topic/topic.module.ts` | BullMQ 依赖注册 |

---

## 关联影响分析

在修复前对删除操作进行了全面关联排查：

| 功能模块 | 状态 | 说明 |
|---------|------|------|
| 数据库级联（FK） | 软删除后不再触发 | Service 层手动处理 |
| 向量嵌入 (page_embeddings) | 已修复 | 通过 PAGE_MOVED_TO_SPACE Job 同步 |
| 页面 CRUD 与分类 | 无需改动 | 页面移动/复制已处理 directoryId/topicId |
| 全文搜索 | 无需改动 | 已支持 directoryId/topicId 过滤 |
| WebSocket 事件 | 无需改动 | 已注册 deleteDirectory/deleteTopic 事件 |
| 评论/附件/反向链接 | 无影响 | 基于 pageId 关联 |
| 公开 Wiki | 无影响 | 仅基于 spaceId/pageId |

---

## 已知的待改进项（P1/P2）

| 优先级 | 问题 | 说明 |
|--------|------|------|
| P1 | DTO 校验不完整 | description/icon 缺少 MaxLength，name 允许全空格 |
| P1 | 回收站页面恢复校验 | 恢复时应检查 directoryId/topicId 是否仍存在 |
| P2 | 权限模型 | 当前复用 SpaceCaslSubject.Settings，二期需定义 Directory/Topic Subject |
| P2 | 缺少 slug 索引 | 建议添加 UNIQUE INDEX ON (LOWER(slug), space_id) WHERE deleted_at IS NULL |
| P2 | 前端 icon 编辑入口 | 表单 Modal 缺少 icon 字段输入 |
| P2 | Agent RAG 分类过滤 | docmost_rag 工具不支持 directoryId/topicId 参数 |
| P2 | 导出不含分类信息 | export 未包含 directoryId/topicId 元数据 |
