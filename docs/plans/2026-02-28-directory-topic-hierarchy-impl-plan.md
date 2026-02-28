# Directory/Topic 层级系统实现计划（v2 — 含 Codex 评审修正）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Docmost 实现 Space → Directory → Topic → Page 四级文档组织层级。

**Architecture:** 独立表（directories + topics，一期无 member 表），权限纯继承 Space。pages 表新增可选外键。侧边栏分组折叠式混合树。管理入口在 SpaceSettingsModal 的 Tab 中。

**Tech Stack:** NestJS 11 + Kysely + PostgreSQL (后端), React 18 + Mantine + react-arborist + Jotai (前端)

**Design Doc:** `docs/plans/2026-02-28-directory-topic-hierarchy-design.md`

---

## Codex 评审修正清单

| 阻断问题 | 修正 |
|----------|------|
| db.d.ts 是 codegen 产物 | 不手工编辑，迁移后运行 `pnpm migration:codegen` |
| DatabaseModule 需注册 Repo | 每个新 Repo 在 `database.module.ts` 的 providers + exports 注册 |
| 页面写入链路不全 | 补充 movePageToSpace / duplicatePage / import / export 适配 |
| Typesense 双路径搜索 | 标注 EE Typesense 模块需检查 |
| page_embeddings 动态创建 | 字段扩展放在运行时创建逻辑中，补 PAGE_MOVED_TO_SPACE 处理 |

| 采纳的风险建议 | 修正 |
|--------------|------|
| 权限覆盖延迟二期 | 一期不建 directory_members / topic_members，纯继承 Space 权限 |
| 管理入口改为 Modal Tab | 在 SpaceSettingsModal 中新增 Directories/Topics Tab |
| WebSocket 事件扩展 | ws.gateway.ts 添加 directory/topic 事件类型 |

---

## Phase 1: 数据库迁移

### Task 1: 创建迁移 + 重生成类型

**Files:**
- Create: `apps/server/src/database/migrations/20260228T120000-directories-topics.ts`
- Auto-gen: `apps/server/src/database/types/db.d.ts` (via codegen)
- Modify: `apps/server/src/database/types/entity.types.ts`

**Step 1: 创建迁移文件**

```typescript
// apps/server/src/database/migrations/20260228T120000-directories-topics.ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. directories 表
  await db.schema
    .createTable('directories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'varchar')
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar')
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('uq_directory_slug_space', ['slug', 'space_id'])
    .execute();

  await db.schema
    .createIndex('idx_directories_space')
    .on('directories')
    .columns(['space_id'])
    .where('deleted_at', 'is', null)
    .execute();

  // 2. topics 表
  await db.schema
    .createTable('topics')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'varchar')
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar')
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('uq_topic_slug_directory', ['slug', 'directory_id'])
    .execute();

  await db.schema
    .createIndex('idx_topics_directory')
    .on('topics')
    .columns(['directory_id'])
    .where('deleted_at', 'is', null)
    .execute();

  await db.schema
    .createIndex('idx_topics_space')
    .on('topics')
    .columns(['space_id'])
    .where('deleted_at', 'is', null)
    .execute();

  // 3. pages 表新增列
  await db.schema
    .alterTable('pages')
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('pages')
    .addColumn('topic_id', 'uuid', (col) =>
      col.references('topics.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_pages_directory_id')
    .on('pages')
    .columns(['directory_id'])
    .where('deleted_at', 'is', null)
    .execute();

  await db.schema
    .createIndex('idx_pages_topic_id')
    .on('pages')
    .columns(['topic_id'])
    .where('deleted_at', 'is', null)
    .execute();

  // 4. 数据库级一致性约束（评审修正#3）
  // topic.space_id 必须等于其 directory 的 space_id（应用层校验 + 触发器双保险）
  await sql`
    CREATE OR REPLACE FUNCTION check_topic_space_consistency()
    RETURNS TRIGGER AS $$
    DECLARE dir_space_id UUID;
    BEGIN
      SELECT space_id INTO dir_space_id FROM directories WHERE id = NEW.directory_id;
      IF dir_space_id IS DISTINCT FROM NEW.space_id THEN
        RAISE EXCEPTION 'topic.space_id must match directory.space_id';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_topic_space_consistency
    BEFORE INSERT OR UPDATE ON topics
    FOR EACH ROW EXECUTE FUNCTION check_topic_space_consistency();
  `.execute(db);

  // page 的 topic 必须属于其 directory（如果两者同时存在）
  await sql`
    CREATE OR REPLACE FUNCTION check_page_category_consistency()
    RETURNS TRIGGER AS $$
    DECLARE topic_dir_id UUID;
    BEGIN
      IF NEW.topic_id IS NOT NULL AND NEW.directory_id IS NOT NULL THEN
        SELECT directory_id INTO topic_dir_id FROM topics WHERE id = NEW.topic_id;
        IF topic_dir_id IS DISTINCT FROM NEW.directory_id THEN
          RAISE EXCEPTION 'page.directory_id must match topic.directory_id';
        END IF;
      END IF;
      IF NEW.topic_id IS NOT NULL AND NEW.directory_id IS NULL THEN
        SELECT directory_id INTO NEW.directory_id FROM topics WHERE id = NEW.topic_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_page_category_consistency
    BEFORE INSERT OR UPDATE ON pages
    FOR EACH ROW EXECUTE FUNCTION check_page_category_consistency();
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_page_category_consistency ON pages`.execute(db);
  await sql`DROP FUNCTION IF EXISTS check_page_category_consistency()`.execute(db);
  await sql`DROP TRIGGER IF EXISTS trg_topic_space_consistency ON topics`.execute(db);
  await sql`DROP FUNCTION IF EXISTS check_topic_space_consistency()`.execute(db);
  await db.schema.alterTable('pages').dropColumn('topic_id').execute();
  await db.schema.alterTable('pages').dropColumn('directory_id').execute();
  await db.schema.dropTable('topics').ifExists().execute();
  await db.schema.dropTable('directories').ifExists().execute();
}
```

**Step 2: 运行迁移**

Run: `cd apps/server && pnpm migration:latest`

**Step 3: 重生成 Kysely 类型（评审修正#1）**

Run: `cd apps/server && pnpm migration:codegen`

这会自动更新 `db.d.ts`，新增 Directories/Topics interface 和 Pages 的 directoryId/topicId 字段。

**Step 4: 更新 entity.types.ts**

在 `apps/server/src/database/types/entity.types.ts` 中新增导入和类型（在文件末尾 AiPromptTemplate 之后）：

```typescript
import { ..., Directories, Topics } from './db';

// Directory
export type Directory = Selectable<Directories>;
export type InsertableDirectory = Insertable<Directories>;
export type UpdatableDirectory = Updateable<Omit<Directories, 'id'>>;

// Topic
export type Topic = Selectable<Topics>;
export type InsertableTopic = Insertable<Topics>;
export type UpdatableTopic = Updateable<Omit<Topics, 'id'>>;
```

**Step 5: Commit**

```bash
git add apps/server/src/database/migrations/20260228T120000-directories-topics.ts
git add apps/server/src/database/types/
git commit -m "feat(db): add directories and topics tables with consistency triggers"
```

---

## Phase 2: 后端 Directory 模块

### Task 2: Directory Repository + DatabaseModule 注册

**Files:**
- Create: `apps/server/src/database/repos/directory/directory.repo.ts`
- Modify: `apps/server/src/database/database.module.ts` — 注册 provider + export（评审修正#2）

**Step 1: 创建 DirectoryRepo**

参考 `space.repo.ts` 模式。关键方法：
- `findById(directoryId, workspaceId)` — 支持 UUID 或 slug
- `insertDirectory(data, trx?)` — 返回完整对象
- `updateDirectory(data, directoryId, workspaceId, trx?)`
- `deleteDirectory(directoryId, workspaceId)` — 物理删除（CASCADE 级联）
- `getDirectoriesInSpace(spaceId, workspaceId, pagination)` — 游标分页
- `slugExists(slug, spaceId, excludeId?)` — slug 唯一性检查

**Step 2: 注册到 DatabaseModule（评审修正#2）**

修改 `apps/server/src/database/database.module.ts`：
- `providers` 数组添加 `DirectoryRepo`
- `exports` 数组添加 `DirectoryRepo`

**Step 3: Commit**

```bash
git add apps/server/src/database/repos/directory/
git add apps/server/src/database/database.module.ts
git commit -m "feat(db): add DirectoryRepo and register in DatabaseModule"
```

---

### Task 3: Directory DTO + Service + Controller + Module

**Files:**
- Create: `apps/server/src/core/directory/dto/directory.dto.ts`
- Create: `apps/server/src/core/directory/directory.service.ts`
- Create: `apps/server/src/core/directory/directory.controller.ts`
- Create: `apps/server/src/core/directory/directory.module.ts`
- Modify: `apps/server/src/core/core.module.ts` — 注册 DirectoryModule

**DTO 定义**（`directory.dto.ts`）:
- `DirectoryIdDto` { directoryId: string }
- `DirectoryListDto` { spaceId: string }
- `CreateDirectoryDto` { name, description?, slug, icon?, spaceId }
- `UpdateDirectoryDto` extends PartialType(Create) { directoryId }

**Controller 端点**（全 POST，`/api/directories`）:
| 端点 | 权限 | 说明 |
|------|------|------|
| `/list` | Space Read | 获取 Space 下目录列表 |
| `/info` | Space Read | 获取目录详情 |
| `/create` | Space Manage | 创建目录（SpaceAbility 检查） |
| `/update` | Space Manage | 更新目录 |
| `/delete` | Space Manage | 删除目录 |

**权限模式**（一期纯继承）：使用现有 `SpaceAbilityFactory`，通过 directory.spaceId 检查 Space 权限。

**Service 关键逻辑**：
- `createDirectory`: 生成 position（fractional-indexing），校验 slug 唯一性，插入
- `deleteDirectory`: 物理删除（DB CASCADE 处理级联）
- `updateDirectory`: 校验 slug 唯一性（排除自身）

**Commit:** `feat(backend): add Directory module with CRUD (pure Space permission inheritance)`

---

## Phase 3: 后端 Topic 模块

### Task 4: Topic Repository + DatabaseModule 注册

与 Task 2 平行结构，但：
- `getTopicsInDirectory(directoryId, workspaceId, pagination)` — 按 directoryId 过滤
- `findById` 查询 topics 表
- 注册到 DatabaseModule

**Commit:** `feat(db): add TopicRepo and register in DatabaseModule`

---

### Task 5: Topic DTO + Service + Controller + Module

与 Task 3 平行，但：
- `CreateTopicDto` 需要 `directoryId`（必填）
- `TopicService.createTopic` 从 directory 推导 spaceId 和 workspaceId
- 权限检查通过 `directory.spaceId` 使用 SpaceAbility
- 注册到 CoreModule

**Commit:** `feat(backend): add Topic module with CRUD (pure Space permission inheritance)`

---

## Phase 4: Page 全链路集成（评审修正#4）

### Task 6: 修改 Page CRUD + 所有写入路径

**Files:**
- Modify: `apps/server/src/core/page/dto/create-page.dto.ts` — 新增 directoryId/topicId
- Modify: `apps/server/src/core/page/dto/sidebar-page.dto.ts` — 新增过滤参数
- Modify: `apps/server/src/core/page/dto/move-page.dto.ts` — 新增 directoryId/topicId
- Modify: `apps/server/src/core/page/services/page.service.ts`:
  - `create()` — 传递 directoryId/topicId（触发器自动校验一致性）
  - `getSidebarPages()` — 支持 directoryId/topicId/filterUncategorized 过滤
  - `getPageBreadCrumbs()` — 返回值包含 directory/topic 信息
  - `movePage()` — 支持修改 directoryId/topicId
  - **`movePageToSpace()`** — 清空 directoryId/topicId（评审修正#4.1）
  - **`duplicatePage()`** — 同 space 复制保留分类；跨 space 复制清空（评审修正#4.2）
- Modify: `apps/server/src/database/repos/page/page.repo.ts`:
  - `baseFields` 新增 `'directoryId'`, `'topicId'`
  - `getSidebarPages()` 新增 WHERE 条件

**关键改动 — movePageToSpace（评审修正#4.1）**：

```typescript
// page.service.ts movePageToSpace 方法中，更新页面时清空分类
await this.pageRepo.updatePage(
  { spaceId, parentPageId: null, position: nextPosition, directoryId: null, topicId: null },
  rootPage.id,
  trx,
);
// 批量更新所有后代页面也清空分类
await this.pageRepo.updatePages(
  { spaceId, directoryId: null, topicId: null },
  descendantPageIds,
  trx,
);
```

**关键改动 — duplicatePage（评审修正#4.2）**：

```typescript
// 构建 InsertablePage 时，根据是否同 space 决定是否保留分类
const isSameSpace = targetSpaceId === rootPage.spaceId || !targetSpaceId;
// ...
directoryId: isSameSpace ? rootPage.directoryId : null,
topicId: isSameSpace ? rootPage.topicId : null,
```

**Commit:** `feat(page): integrate directory/topic into all page write paths`

---

### Task 7: Import / Export 适配（评审修正#4.3/4.4）

**Files:**
- Modify: `apps/server/src/integrations/import/services/import.service.ts` — insertPage 默认 null
- Modify: `apps/server/src/integrations/export/export.service.ts` — SELECT 包含 directoryId/topicId

**Import 改动**：导入页面默认 directoryId=null, topicId=null（未分类），无需额外处理。但需确认 InsertablePage 的类型签名允许 null。

**Export 改动**：在导出 SELECT 中添加 `'pages.directoryId'`, `'pages.topicId'`，使导出元数据包含分类信息。

**Commit:** `feat(import-export): include directory/topic fields in page import and export`

---

## Phase 5: 搜索 + 向量集成（评审修正#5）

### Task 8: 全文搜索 + Typesense + 向量搜索

**Files:**
- Modify: `apps/server/src/core/search/dto/search.dto.ts` — 新增 directoryId/topicId
- Modify: `apps/server/src/core/search/search.service.ts` — PostgreSQL 全文搜索 WHERE 扩展
- Modify: `apps/server/src/core/search/search.controller.ts` — 传递新参数到 Typesense 路径
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts`:
  - `createEmbeddingsTable()` 中 CREATE TABLE 添加 `"directoryId"` 和 `"topicId"` 列（评审修正#5：运行时动态创建）
  - 补充 `PAGE_MOVED_TO_SPACE` case 处理（评审修正#5：已有 bug 修复）
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts` — 向量搜索 WHERE 扩展

**ai-queue.processor 关键改动**：

```typescript
// createEmbeddingsTable() 中新增列
await sql`
  ALTER TABLE page_embeddings
  ADD COLUMN IF NOT EXISTS "directoryId" UUID,
  ADD COLUMN IF NOT EXISTS "topicId" UUID
`.execute(this.db);

// process() 中补充 PAGE_MOVED_TO_SPACE
case QueueJob.PAGE_MOVED_TO_SPACE: {
  const { pageId, workspaceId } = job.data;
  const pageIds = Array.isArray(pageId) ? pageId : [pageId];
  for (const pid of pageIds) {
    const page = await this.db
      .selectFrom('pages')
      .select(['spaceId', 'directoryId', 'topicId'])
      .where('id', '=', pid)
      .executeTakeFirst();
    if (page) {
      await sql`
        UPDATE page_embeddings
        SET "spaceId" = ${page.spaceId},
            "directoryId" = ${page.directoryId},
            "topicId" = ${page.topicId},
            "updatedAt" = NOW()
        WHERE "pageId" = ${pid}
      `.execute(this.db);
    }
  }
  break;
}
```

**Typesense 说明**：`search.controller.ts` 中的 Typesense 路径通过 EE 动态加载，新增的 searchDto 字段会自动传递。如果 EE 模块未适配，Typesense 搜索会忽略新字段但不会报错。

**Commit:** `feat(search): add directory/topic filter to fulltext, vector, and typesense search paths`

---

## Phase 6: WebSocket 事件扩展（评审修正 — 风险#3）

### Task 9: WebSocket Gateway 适配

**Files:**
- Modify: `apps/server/src/ws/ws.gateway.ts` — 扩展 spaceEvents

```typescript
// 现有 spaceEvents 数组中添加
const spaceEvents = [
  'updateOne',
  'addTreeNode',
  'moveTreeNode',
  'deleteTreeNode',
  'addDirectory',
  'updateDirectory',
  'deleteDirectory',
  'addTopic',
  'updateTopic',
  'deleteTopic',
];
```

**Commit:** `feat(ws): extend WebSocket events for directory and topic operations`

---

## Phase 7: 前端类型 + 服务 + 查询

### Task 10: Directory 前端模块

**Files:**
- Create: `apps/client/src/features/directory/types/directory.types.ts`
- Create: `apps/client/src/features/directory/services/directory-service.ts`
- Create: `apps/client/src/features/directory/queries/directory-query.ts`

**类型**（参考 `space.types.ts`）:
```typescript
export interface IDirectory {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  slug: string;
  position: string;
  spaceId: string;
  workspaceId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**服务**（参考 `space-service.ts`）: 5 个函数（list/info/create/update/delete）

**查询**（参考 `space-query.ts`）: useGetDirectoriesQuery, useCreateDirectoryMutation, useUpdateDirectoryMutation, useDeleteDirectoryMutation

**Commit:** `feat(frontend): add Directory types, services, and query hooks`

---

### Task 11: Topic 前端模块

与 Task 10 平行，但 Topic 需要 `directoryId`。

**Commit:** `feat(frontend): add Topic types, services, and query hooks`

---

### Task 12: 扩展 Page 前端类型

**Files:**
- Modify: `apps/client/src/features/page/types/page.types.ts` — IPage 新增 directoryId/topicId; SidebarPagesParams 新增过滤参数
- Modify: `apps/client/src/features/page/tree/types.ts` — SpaceTreeNode 新增 nodeType

```typescript
// page.types.ts IPage 新增
directoryId?: string;
topicId?: string;

// page.types.ts SidebarPagesParams 新增
directoryId?: string;
topicId?: string;
filterUncategorized?: boolean;

// tree types.ts SpaceTreeNode 新增
nodeType: 'directory' | 'topic' | 'page';
directoryId?: string;
topicId?: string;
```

**Commit:** `feat(frontend): extend page and tree types with directory/topic fields`

---

## Phase 8: 前端管理入口（评审修正 — Modal Tab）

### Task 13: SpaceSettingsModal 新增 Directories + Topics Tab

**Files:**
- Create: `apps/client/src/features/directory/components/directory-list.tsx`
- Create: `apps/client/src/features/directory/components/directory-form-modal.tsx`
- Create: `apps/client/src/features/topic/components/topic-list.tsx`
- Create: `apps/client/src/features/topic/components/topic-form-modal.tsx`
- Create: `apps/client/src/features/directory/components/directory-select.tsx`
- Modify: `apps/client/src/features/space/components/settings-modal.tsx` — 新增 Tab

**SpaceSettingsModal 改动**：

```typescript
// settings-modal.tsx 新增 Tab
<Tabs.Tab fw={500} value="directories">{t("Directories")}</Tabs.Tab>
<Tabs.Tab fw={500} value="topics">{t("Topics")}</Tabs.Tab>

<Tabs.Panel value="directories">
  <DirectoryList spaceId={space?.id} readOnly={...} />
</Tabs.Panel>

<Tabs.Panel value="topics">
  <TopicList spaceId={space?.id} readOnly={...} />
</Tabs.Panel>
```

**DirectoryList 组件**：
- 表格显示目录列表（名称、图标、slug、操作）
- "创建目录"按钮 → DirectoryFormModal
- 编辑/删除操作

**TopicList 组件**：
- 顶部 DirectorySelect 下拉
- 选择目录后显示 Topic 列表
- "创建主题"按钮 → TopicFormModal

**Commit:** `feat(frontend): add Directories and Topics tabs to SpaceSettingsModal`

---

## Phase 9: 侧边栏重构（评审修正 — WebSocket/Cache）

### Task 14: 侧边栏混合树

**Files:**
- Modify: `apps/client/src/features/page/tree/utils/utils.ts` — buildMixedTree 函数
- Modify: `apps/client/src/features/page/tree/components/space-tree.tsx` — 混合数据加载 + 节点渲染
- Modify: `apps/client/src/features/page/tree/hooks/use-tree-mutation.ts` — 拖拽规则
- Modify: `apps/client/src/features/space/components/sidebar/space-sidebar.tsx` — 数据流

**数据加载流程**：
1. 并行加载：Space 下 Directory 列表 + 未分类根页面
2. 组装混合树根：[Directory 节点..., 未分类 Page 节点...]
3. 展开 Directory → 加载 Topics + Directory 下未分类页面
4. 展开 Topic → 加载 Topic 下根页面
5. 展开 Page → 现有子页面加载逻辑不变

**节点渲染区分**：
- `nodeType === 'directory'`: 📁 图标 + 粗体 + 右键菜单含"新建 Topic"/"新建 Page"
- `nodeType === 'topic'`: 🏷️ 图标 + 右键菜单含"新建 Page"
- `nodeType === 'page'`: 现有逻辑不变

**拖拽规则**（`canDrop` 回调）：
- page → directory: 设 directoryId，清 topicId
- page → topic: 设 topicId（触发器自动填 directoryId）
- page → uncategorized area: 清空 directoryId/topicId
- directory 节点：只能在 Space 内排序
- topic 节点：只能在 Directory 内排序

**WebSocket 缓存同步**（评审修正）：
- 收到 `addDirectory`/`deleteDirectory` 事件 → 刷新 directory 列表 query
- 收到 `addTopic`/`deleteTopic` 事件 → 刷新 topic 列表 query
- 收到 `moveTreeNode` 事件带 directoryId/topicId 变更 → 更新本地树

**Commit:** `feat(frontend): refactor sidebar to support directory/topic/page mixed tree`

---

## Phase 10: 面包屑 + 移动模态框

### Task 15: 面包屑改造

**Files:**
- Modify: `apps/client/src/features/page/components/breadcrumbs/breadcrumb.tsx`
- Modify: `apps/client/src/features/page/services/page-service.ts` — breadcrumbs API 适配

面包屑从 API 获取 directory/topic 可选对象，在 page 链前 prepend 展示。

**Commit:** `feat(frontend): extend breadcrumbs with directory/topic prefix`

---

### Task 16: 移动页面模态框改造

**Files:**
- Modify: `apps/client/src/features/page/components/move-page-modal.tsx`
- Modify: `apps/client/src/features/page/components/copy-page-modal.tsx`
- Create: `apps/client/src/features/topic/components/topic-select.tsx`

级联 Select：Space → Directory（含"未分类"选项）→ Topic（含"无主题"选项）

**Commit:** `feat(frontend): add cascading directory/topic select to move/copy modals`

---

## Phase 11: 收尾验证

### Task 17: 编译验证 + 最终清理

**Step 1: 后端编译**
Run: `cd apps/server && pnpm build`

**Step 2: 前端编译**
Run: `cd apps/client && pnpm build`

**Step 3: 类型检查（如有 typecheck 脚本）**
Run: `pnpm typecheck`

**Step 4: Commit**
```bash
git add -A
git commit -m "chore: final cleanup and type fixes for directory/topic hierarchy"
```

---

## 实现顺序依赖图

```
Task 1 (迁移 + codegen)
  ├→ Task 2 (Directory Repo) → Task 3 (Directory Module)
  ├→ Task 4 (Topic Repo) → Task 5 (Topic Module)
  ├→ Task 6 (Page 全链路) ← depends on Task 3 + Task 5
  ├→ Task 7 (Import/Export) ← depends on Task 1
  ├→ Task 8 (搜索集成) ← depends on Task 1
  └→ Task 9 (WebSocket)

  Task 10-12 (前端类型/服务) ← depends on Task 3 + Task 5
    ├→ Task 13 (Modal Tab 管理)
    ├→ Task 14 (侧边栏重构) ← depends on Task 9
    ├→ Task 15 (面包屑)
    └→ Task 16 (移动模态框)

  Task 17 (收尾验证) ← depends on all
```

**并行可能性**：
- Task 2+4 可并行（互不依赖）
- Task 3+5 可并行
- Task 7+8+9 可并行（均仅依赖 Task 1）
- Task 10+11 可并行
- Task 14+15+16 可并行

---

## 与 v1 计划对比

| 项目 | v1 | v2（评审修正后） |
|------|-----|-----------------|
| 新建表 | 4 张（含 2 member 表） | **2 张**（无 member 表） |
| 权限模型 | 继承+覆盖（3 层计算） | **纯继承**（直接用 SpaceAbility） |
| 管理入口 | 独立 /settings 页面 | **Modal Tab**（复用 SpaceSettingsModal） |
| db.d.ts | 手工编辑 | **codegen 自动生成** |
| DatabaseModule | 遗漏 | **显式注册** |
| 页面写入 | 仅 create/move/sidebar | **全链路：+moveToSpace/duplicate/import/export** |
| 搜索 | 仅 PostgreSQL | **PostgreSQL + Typesense + Vector** |
| page_embeddings | 迁移 ALTER | **运行时动态 ALTER IF NOT EXISTS** |
| DB 约束 | 仅 FK | **FK + 触发器**（space/directory 一致性） |
| WebSocket | 遗漏 | **扩展 spaceEvents** |
| Task 数 | 18 | **17**（减少了 member 相关任务） |
