# 目录/主题层级系统设计文档

> 日期：2026-02-28
> 状态：已批准（v2，含 Codex 评审修正）
> 分支：feater-dir-refactor

## 1. 概述

将 Docmost 的文档路径从 `Space → Page` 扩展为 `Space → [Directory] → [Topic] → Page`，为文档提供更丰富的分类组织能力。

### 1.1 核心决策摘要

| 维度 | 决策 |
|------|------|
| 层级结构 | Space → Directory(扁平) → Topic(扁平) → Page(可嵌套) |
| 嵌套方式 | Directory/Topic 均为一级扁平，Page 保留 parent_page_id 无限嵌套 |
| 权限模式 | **一期：纯继承 Space 权限**（二期加覆盖能力） |
| 架构方案 | 独立表（directories + topics，**一期无 member 表**） |
| 侧边栏 | 分组折叠式（Directory/Topic/Page 混合树） |
| 管理入口 | **SpaceSettingsModal 内新增 Tab**（非独立路由） |
| URL 路由 | 不变，保持 /s/:spaceSlug/p/:pageSlug |
| 删除 Directory | 级联删除其下 Topic，页面变未分类 |
| 删除 Topic | 页面保留在 Directory 下（topic_id=null） |

### 1.2 实体关系

```
Workspace
└── Space
    ├── Directory (必须属于 Space，扁平)
    │   ├── Topic (必须属于 Directory，扁平)
    │   │   └── Page (可嵌套，parent_page_id)
    │   └── Page (直接挂 Directory，无 Topic)
    └── Page (未分类，directory_id=null, topic_id=null)
```

---

## 2. 数据库设计

### 2.1 新增表

#### directories 表

```sql
CREATE TABLE directories (
  id            UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
  name          VARCHAR NOT NULL,
  description   TEXT,
  icon          VARCHAR,
  slug          VARCHAR NOT NULL,
  position      VARCHAR,                          -- fractional-indexing 排序
  space_id      UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE(slug, space_id)
);

CREATE INDEX idx_directories_space ON directories(space_id) WHERE deleted_at IS NULL;
```

#### topics 表

```sql
CREATE TABLE topics (
  id            UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
  name          VARCHAR NOT NULL,
  description   TEXT,
  icon          VARCHAR,
  slug          VARCHAR NOT NULL,
  position      VARCHAR,                          -- fractional-indexing 排序
  directory_id  UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  space_id      UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE(slug, directory_id)
);

CREATE INDEX idx_topics_directory ON topics(directory_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_topics_space ON topics(space_id) WHERE deleted_at IS NULL;
```

#### directory_members 表

```sql
CREATE TABLE directory_members (
  id            UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
  directory_id  UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id      UUID REFERENCES groups(id) ON DELETE CASCADE,
  role          VARCHAR NOT NULL,  -- 'admin' | 'writer' | 'reader'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR group_id IS NOT NULL)
);

CREATE UNIQUE INDEX uq_directory_member_user ON directory_members(directory_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_directory_member_group ON directory_members(directory_id, group_id) WHERE group_id IS NOT NULL;
```

#### topic_members 表

```sql
CREATE TABLE topic_members (
  id            UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
  topic_id      UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id      UUID REFERENCES groups(id) ON DELETE CASCADE,
  role          VARCHAR NOT NULL,  -- 'admin' | 'writer' | 'reader'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR group_id IS NOT NULL)
);

CREATE UNIQUE INDEX uq_topic_member_user ON topic_members(topic_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_topic_member_group ON topic_members(topic_id, group_id) WHERE group_id IS NOT NULL;
```

### 2.2 修改 pages 表

```sql
ALTER TABLE pages ADD COLUMN directory_id UUID REFERENCES directories(id) ON DELETE SET NULL;
ALTER TABLE pages ADD COLUMN topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
CREATE INDEX idx_pages_directory_id ON pages(directory_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_pages_topic_id ON pages(topic_id) WHERE deleted_at IS NULL;
```

### 2.3 修改 page_embeddings 表

```sql
ALTER TABLE page_embeddings ADD COLUMN "directoryId" UUID;
ALTER TABLE page_embeddings ADD COLUMN "topicId" UUID;
CREATE INDEX idx_page_embeddings_directory ON page_embeddings("directoryId");
CREATE INDEX idx_page_embeddings_topic ON page_embeddings("topicId");
```

### 2.4 删除级联行为

| 操作 | 行为 |
|------|------|
| 删除 Directory | CASCADE 删除其下所有 Topic；pages.directory_id SET NULL, pages.topic_id SET NULL |
| 删除 Topic | pages.topic_id SET NULL（页面保留在 Directory 下） |
| 删除 Space | CASCADE 删除 directories（继而 CASCADE 删除 topics） |

### 2.5 Kysely 类型扩展

DB 接口新增：
```typescript
export interface DB {
  ...existing,
  directories: Directories;
  topics: Topics;
  directoryMembers: DirectoryMembers;
  topicMembers: TopicMembers;
}
```

Pages 接口新增：
```typescript
export interface Pages {
  ...existing,
  directoryId: string | null;
  topicId: string | null;
}
```

---

## 3. API/Service 设计

### 3.1 Directory Module

路径：`apps/server/src/core/directory/`

#### API 端点（全 POST，前缀 `/api/directories`）

| 端点 | 用途 | 权限 |
|------|------|------|
| `/list` | 获取 Space 下目录列表 | Space Read |
| `/info` | 获取目录详情 | Directory Read |
| `/create` | 创建目录 | Space Manage (Admin) |
| `/update` | 更新目录 | Directory Manage |
| `/delete` | 删除目录 | Directory Manage |
| `/members` | 获取成员列表 | Directory Read |
| `/members/add` | 添加成员 | Directory Manage |
| `/members/remove` | 移除成员 | Directory Manage |
| `/members/change-role` | 修改角色 | Directory Manage |

#### DTO

```typescript
class CreateDirectoryDto {
  name: string;       // 2-100 字符
  description?: string;
  slug: string;       // 2-100 字符，alphanumeric
  icon?: string;
  spaceId: string;    // UUID
}

class UpdateDirectoryDto extends PartialType(CreateDirectoryDto) {
  directoryId: string;
}

class DirectoryIdDto {
  directoryId: string;
}

class DirectoryListDto {
  spaceId: string;
}
```

### 3.2 Topic Module

路径：`apps/server/src/core/topic/`

#### API 端点（全 POST，前缀 `/api/topics`）

| 端点 | 用途 | 权限 |
|------|------|------|
| `/list` | 获取 Directory 下主题列表 | Directory Read |
| `/info` | 获取主题详情 | Topic Read |
| `/create` | 创建主题 | Directory Manage (Admin) |
| `/update` | 更新主题 | Topic Manage |
| `/delete` | 删除主题 | Topic Manage |
| `/members` | 获取成员列表 | Topic Read |
| `/members/add` | 添加成员 | Topic Manage |
| `/members/remove` | 移除成员 | Topic Manage |
| `/members/change-role` | 修改角色 | Topic Manage |

#### DTO

```typescript
class CreateTopicDto {
  name: string;
  description?: string;
  slug: string;
  icon?: string;
  directoryId: string;   // 必须，UUID
}

class UpdateTopicDto extends PartialType(CreateTopicDto) {
  topicId: string;
}
```

### 3.3 修改现有 Page API

#### CreatePageDto 扩展

```typescript
class CreatePageDto {
  ...existing,
  directoryId?: string;  // 可选
  topicId?: string;      // 可选
}
```

校验逻辑：
- topicId 存在时可省略 directoryId（从 topic 推导）
- directoryId 存在但 topicId 不存在 → 页面挂 Directory 下

#### SidebarPagesDto 扩展

```typescript
class SidebarPagesDto {
  spaceId?: string;
  pageId?: string;
  directoryId?: string;         // 查询目录下页面
  topicId?: string;             // 查询主题下页面
  filterUncategorized?: boolean; // 仅未分类页面
}
```

#### MovePageDto 扩展

```typescript
class MovePageDto {
  ...existing,
  directoryId?: string | null;
  topicId?: string | null;
}
```

#### Breadcrumbs 返回值扩展

```typescript
interface PageBreadcrumbsResponse {
  directory?: { id: string; name: string; slug: string; icon?: string };
  topic?: { id: string; name: string; slug: string; icon?: string };
  pages: Page[];
}
```

### 3.4 搜索扩展

#### SearchDTO 扩展

```typescript
class SearchDTO {
  ...existing,
  directoryId?: string;
  topicId?: string;
}
```

全文搜索 WHERE 子句：
```sql
AND (:directoryId IS NULL OR p.directory_id = :directoryId)
AND (:topicId IS NULL OR p.topic_id = :topicId)
```

向量搜索同理。

---

## 4. 权限系统设计

### 4.1 CASL Subject 扩展

```typescript
enum SpaceCaslSubject {
  Settings = 'settings',
  Member = 'member',
  Page = 'page',
  Share = 'share',
  Directory = 'directory',  // 新增
  Topic = 'topic',          // 新增
}
```

### 4.2 DirectoryAbilityFactory

```typescript
class DirectoryAbilityFactory {
  async createForUser(user: User, directoryId: string): Promise<MongoAbility> {
    // 1. 查 directory_members 获取用户对此目录的角色
    // 2. 查 space_members 获取用户对父 Space 的角色
    // 3. 有覆盖 → effectiveRole = min(directoryRole, spaceRole)
    // 4. 无覆盖 → effectiveRole = spaceRole
    return defineAbility(effectiveRole);
  }
}
```

### 4.3 TopicAbilityFactory

```typescript
class TopicAbilityFactory {
  async createForUser(user: User, topicId: string): Promise<MongoAbility> {
    // 1. 查 topic_members
    // 2. 查 directory_members（父 Directory）
    // 3. 查 space_members（祖父 Space）
    // 4. effectiveRole = min(topicRole ?? directoryRole ?? spaceRole, directoryRole ?? spaceRole, spaceRole)
    return defineAbility(effectiveRole);
  }
}
```

### 4.4 权限计算规则

```
角色优先级: admin > writer > reader
缩小规则: 子级 effectiveRole = min(子级显式角色 ?? 父级角色, 父级角色)

示例:
- Space=writer, Directory=无覆盖 → Directory effective=writer
- Space=writer, Directory=reader → Directory effective=reader
- Space=reader, Directory=writer → Directory effective=reader (不允许放大)
- Space=admin, Directory=writer, Topic=reader → Topic effective=reader
```

---

## 5. 前端设计

### 5.1 侧边栏改造

#### 节点类型扩展

```typescript
type TreeNodeType = 'directory' | 'topic' | 'page';

type SpaceTreeNode = {
  id: string;
  slugId?: string;
  name: string;
  icon?: string;
  position: string;
  spaceId: string;
  nodeType: TreeNodeType;
  parentPageId?: string;
  hasChildren?: boolean;
  directoryId?: string;
  topicId?: string;
  children: SpaceTreeNode[];
};
```

#### 数据加载流程

1. 加载 Space 下的 Directory 列表
2. 加载未分类根页面（filterUncategorized=true）
3. 展开 Directory → 加载其下 Topic + 未分类页面
4. 展开 Topic → 加载其下根页面
5. 展开 Page → 加载子页面（现有逻辑）

#### 侧边栏结构示例

```
Space: Engineering
├─ 📁 Backend (Directory)
│  ├─ 🏷️ API Design (Topic)
│  │  ├─ 📄 REST API Guide
│  │  │  └─ 📄 Endpoint Details (sub-page)
│  │  └─ 📄 GraphQL Schema
│  └─ 🏷️ Database (Topic)
│     └─ 📄 Migration Guide
├─ 📁 Frontend (Directory)
│  └─ 🏷️ Components (Topic)
│     └─ 📄 Button Spec
└─ 📄 Quick Notes (uncategorized page)
```

#### 拖拽规则

- Page → Directory：设置 directory_id，清空 topic_id
- Page → Topic：设置 topic_id 和 directory_id
- Page → 未分类区域：清空 directory_id 和 topic_id
- Directory：只能在 Space 内排序
- Topic：只能在 Directory 内排序

### 5.2 面包屑改造

```
[Directory?] > [Topic?] > [Page1?] > ... > [CurrentPage]
```

面包屑 API 返回 directory/topic 可选字段，前端 prepend 到现有 page 链前。

### 5.3 移动页面模态框改造

级联 Select：Space → Directory → Topic

```
MovePageModal
├── SpaceSelect (现有)
├── DirectorySelect (基于 Space 加载，含"未分类"选项)
└── TopicSelect (基于 Directory 加载，含"无主题"选项)
```

### 5.4 管理页面

新增路由：
- `/settings/spaces/:spaceId/directories` — 目录管理
- `/settings/spaces/:spaceId/topics` — 主题管理

入口：`/settings/spaces` 空间列表行增加管理按钮。

### 5.5 前端文件结构

```
apps/client/src/features/directory/
├── components/
│   ├── directory-list.tsx
│   ├── directory-form-modal.tsx
│   ├── directory-members.tsx
│   └── directory-select.tsx
├── queries/directory-query.ts
├── services/directory-service.ts
└── types/directory.types.ts

apps/client/src/features/topic/
├── (同上结构)

apps/client/src/pages/settings/space/
├── directory-management.tsx
└── topic-management.tsx
```

---

## 6. 搜索保护 & 数据同步

### 6.1 全文搜索

- tsvector 无需变化（仍索引 title + text_content）
- 搜索 WHERE 子句新增 directory_id/topic_id 可选过滤
- 新增 pages 表的 directory_id/topic_id 索引

### 6.2 向量搜索

- page_embeddings 新增 directoryId/topicId 字段
- 页面创建/更新 embedding 时写入对应 ID
- 新增 PAGE_CATEGORY_CHANGED 事件：移动页面分类时同步 embedding
- 向量搜索 WHERE 子句新增可选过滤

### 6.3 权限对搜索的影响

当前设计中权限只能缩小，最低角色为 Reader（仍可读），因此：
- 用户能看到 Space → 能搜到该 Space 所有 Directory/Topic 下的页面
- directory_members/topic_members 覆盖只影响写/管理权限，不影响搜索可见性

---

## 7. 数据迁移方案

### 7.1 Schema 迁移

单个迁移文件：`20260228T120000-directories-topics.ts`

1. 创建 directories/topics/directory_members/topic_members 表
2. ALTER pages 新增 directory_id/topic_id
3. 创建所有索引

### 7.2 Embedding 回填

异步队列任务：遍历已有 page_embeddings，根据关联 page 的 directory_id/topic_id 回填。

### 7.3 兼容性保证

| 场景 | 处理 |
|------|------|
| 存量页面无 directory_id/topic_id | NULL = 未分类，完全兼容 |
| 存量 page_embeddings | NULL，搜索不过滤时正常匹配 |
| 旧版 sidebar-pages 调用 | 无新参数时返回全部页面 |
| 页面 URL | 不变 |
| 面包屑 API | directory/topic 字段可选 |

---

## 8. 影响范围

### 8.1 后端新增文件

| 路径 | 说明 |
|------|------|
| `apps/server/src/core/directory/` | Directory 模块（controller/service/dto） |
| `apps/server/src/core/topic/` | Topic 模块 |
| `apps/server/src/database/repos/directory/` | Directory Repo |
| `apps/server/src/database/repos/topic/` | Topic Repo |
| `apps/server/src/core/casl/abilities/directory-ability.factory.ts` | Directory 权限 |
| `apps/server/src/core/casl/abilities/topic-ability.factory.ts` | Topic 权限 |
| `apps/server/src/database/migrations/20260228T120000-directories-topics.ts` | 迁移 |

### 8.2 后端修改文件

| 路径 | 修改内容 |
|------|---------|
| `apps/server/src/app.module.ts` | 注册 DirectoryModule/TopicModule |
| `apps/server/src/database/types/db.d.ts` | 新增类型 |
| `apps/server/src/database/types/entity.types.ts` | 新增类型导出 |
| `apps/server/src/core/page/page.controller.ts` | breadcrumbs/sidebar 扩展 |
| `apps/server/src/core/page/services/page.service.ts` | 创建/移动页面适配 |
| `apps/server/src/core/page/dto/*.ts` | DTO 扩展 |
| `apps/server/src/database/repos/page/page.repo.ts` | 查询条件扩展 |
| `apps/server/src/core/search/search.service.ts` | 搜索过滤扩展 |
| `apps/server/src/core/search/dto/search.dto.ts` | DTO 扩展 |
| `apps/server/src/ee/ai/services/ai-search.service.ts` | 向量搜索过滤 |
| `apps/server/src/ee/ai/ai-queue.processor.ts` | embedding 同步 |
| `apps/server/src/database/listeners/page.listener.ts` | 新事件处理 |
| `apps/server/src/core/casl/interfaces/space-ability.type.ts` | Subject 扩展 |

### 8.3 前端新增文件

| 路径 | 说明 |
|------|------|
| `apps/client/src/features/directory/` | Directory 组件/查询/服务/类型 |
| `apps/client/src/features/topic/` | Topic 组件/查询/服务/类型 |
| `apps/client/src/pages/settings/space/directory-management.tsx` | 管理页 |
| `apps/client/src/pages/settings/space/topic-management.tsx` | 管理页 |

### 8.4 前端修改文件

| 路径 | 修改内容 |
|------|---------|
| `apps/client/src/App.tsx` | 新路由 |
| `apps/client/src/features/page/tree/types.ts` | 节点类型扩展 |
| `apps/client/src/features/page/tree/components/space-tree.tsx` | 混合树渲染 |
| `apps/client/src/features/page/tree/hooks/use-tree-mutation.ts` | 拖拽规则 |
| `apps/client/src/features/page/tree/utils/utils.ts` | 树工具函数 |
| `apps/client/src/features/page/components/breadcrumbs/breadcrumb.tsx` | 面包屑扩展 |
| `apps/client/src/features/page/components/move-page-modal.tsx` | 级联选择 |
| `apps/client/src/features/page/components/copy-page-modal.tsx` | 级联选择 |
| `apps/client/src/features/page/services/page-service.ts` | API 参数扩展 |
| `apps/client/src/features/page/queries/page-query.ts` | 查询 hooks 扩展 |
| `apps/client/src/features/page/types/page.types.ts` | 类型扩展 |
| `apps/client/src/features/space/components/sidebar/space-sidebar.tsx` | 侧边栏重构 |
| `apps/client/src/pages/settings/space/spaces.tsx` | 管理入口 |
