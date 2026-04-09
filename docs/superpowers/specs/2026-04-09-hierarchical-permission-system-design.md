# 层级权限系统设计方案

> **状态**：设计已批准，待实施  
> **日期**：2026-04-09  
> **作者**：Leo / Claude  
> **范围**：Docmost 权限体系扩展——三级权限 + 统一覆盖表 + Wiki 数据库驱动公开控制

---

## 1. 背景与动机

### 1.1 现状

Docmost 当前权限体系为两层模型：

- **工作区层**（Workspace）：OWNER / ADMIN / MEMBER
- **空间层**（Space）：ADMIN / WRITER / READER，通过 `space_members` 表存储

权限检查链路：`DomainMiddleware → JwtAuthGuard → SpaceAbilityFactory → Controller`。

### 1.2 问题

1. **粒度不足**：无法对单个 Directory 或 Page 设置独立权限
2. **Wiki 公开控制僵硬**：通过环境变量 `WIKI_PUBLIC_SPACE_SLUGS` 控制，改配置需重启服务
3. **前端权限是粗粒度布尔开关**：`editable: boolean` 和 `readOnly: boolean` 无法区分编辑/删除/分享等操作
4. **侧边栏无权限过滤**：用户可看到所有页面标题，包括无权限的内容

### 1.3 目标

引入三级权限模型（Space → Directory → Page），支持就近覆盖，同时保持对现有系统的零破坏兼容。

---

## 2. 设计决策记录

| 决策 | 选项 | 结论 | 理由 |
|------|------|------|------|
| 覆盖规则 | A.就近覆盖 / B.只能缩小 / C.混合 | **A** | 灵活，符合 Google Drive/钉钉行为 |
| 权限层级 | A.四级 / B.三级 / C.两级 | **B** | Topic 是分类标签非权限边界，三级最佳平衡 |
| 角色体系 | A.复用3+NONE / B.扩展5角色 / C.3+NONE,COMMENTER后加 | **C** | 先 ship 核心，COMMENTER 独立迭代 |
| Wiki 公开控制 | A.数据库驱动 / B.保持环境变量 | **A** | 管理员 UI 可控，环境变量作 fallback |
| 实现方案 | A.新表+保留space_members / B.全迁移 / C.扩展space_members | **A** | 最小改动面，零迁移风险 |

---

## 3. 数据模型

### 3.1 新增表 `resource_permissions`

```sql
CREATE TABLE resource_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type   VARCHAR(20) NOT NULL,
  resource_id     UUID NOT NULL,
  principal_type  VARCHAR(10) NOT NULL,
  principal_id    UUID NOT NULL,
  role            VARCHAR(20) NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_resource_principal 
    UNIQUE(resource_type, resource_id, principal_type, principal_id),
  CONSTRAINT chk_principal_type 
    CHECK (principal_type IN ('user', 'group')),
  CONSTRAINT chk_resource_type 
    CHECK (resource_type IN ('directory', 'page')),
  CONSTRAINT chk_role 
    CHECK (role IN ('admin', 'writer', 'reader', 'none'))
);

CREATE INDEX idx_rp_principal 
  ON resource_permissions(principal_type, principal_id, workspace_id);
CREATE INDEX idx_rp_resource 
  ON resource_permissions(resource_type, resource_id);
CREATE INDEX idx_rp_workspace 
  ON resource_permissions(workspace_id);
```

### 3.2 现有表改动

无。`spaces`（visibility 字段已存在）、`space_members`、`pages`、`directories` 均不改动。

### 3.3 级联删除

`resource_id` 不做外键（多态字段）。通过 NestJS EventEmitter 在删除 Directory/Page 时清理对应记录：

```typescript
@OnEvent('directory.deleted')
async handleDirectoryDeleted(payload: { directoryId: string }) {
  await this.resourcePermRepo.deleteByResource('directory', payload.directoryId);
}

@OnEvent('page.deleted')
async handlePageDeleted(payload: { pageId: string }) {
  await this.resourcePermRepo.deleteByResource('page', payload.pageId);
}
```

### 3.4 与 shares 表的关系

| 表 | 控制对象 | 场景 |
|---|---|---|
| `resource_permissions` | 内部登录用户权限 | Docmost 后台 |
| `shares` | 外部匿名用户公开分享 | 分享链接 |

两套机制独立，互不替代。

---

## 4. 权限解析引擎

### 4.1 三级解析链

```
resolvePermission(user, page):
  ① resource_permissions(page)      → 命中？返回最高角色
  ② resource_permissions(directory)  → 命中？返回最高角色（page.directory_id 为空则跳过）
  ③ space_members(space)             → 命中？返回最高角色
  ④ 无记录 → NotFoundException
```

核心规则：
- 每步合并用户直接角色 + 所属 Group 角色，取最高
- **命中即返回**，不继续上溯——就近覆盖
- `role='none'` 命中也算命中——拒绝访问，不上溯
- **none 优先规则**：同一层级（同一 resourceId）若存在任意一条 `none` 记录（无论来自用户还是 Group），该层级结果**直接为 none**，不参与"取最高"排序。`none` 是显式拒绝（黑名单），语义上优先于任何正向角色
  - 示例：用户张三直接被赋予 page 层级 `writer`，同时张三所属 Group「外包组」在同一 page 被设为 `none` → 结果为 `none`（Group 的拒绝覆盖个人的正向授权）
  - 若需要给张三单独开放，应先移除 Group 的 `none` 记录，或将张三从该 Group 移出

### 4.2 ResourceAbilityFactory

```typescript
// apps/server/src/core/casl/abilities/resource-ability.factory.ts

@Injectable()
export class ResourceAbilityFactory {
  constructor(
    private readonly resourcePermRepo: ResourcePermissionRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async createForUser(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    context: { directoryId?: string; spaceId: string },
  ): Promise<MongoAbility<ISpaceAbility>> {
    const role = await this.resolveRole(user, resourceType, resourceId, context);
    return buildAbilityByRole(role);
  }

  async resolveRole(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    context: { directoryId?: string; spaceId: string },
  ): Promise<string> {
    // Step 1: 资源自身 override
    const selfRole = await this.findHighestRole(user, resourceType, resourceId);
    if (selfRole) return selfRole;

    // Step 2: page 的 directory override
    if (resourceType === 'page' && context.directoryId) {
      const dirRole = await this.findHighestRole(user, 'directory', context.directoryId);
      if (dirRole) return dirRole;
    }

    // Step 3: 回退到 space_members
    const spaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id, context.spaceId,
    );
    const spaceRole = findHighestUserSpaceRole(spaceRoles);
    if (spaceRole) return spaceRole;

    throw new NotFoundException('Permissions not found');
  }

  private async findHighestRole(
    user: User,
    resourceType: string,
    resourceId: string,
  ): Promise<string | null> {
    const roles = await this.resourcePermRepo.getUserResourceRoles(
      user.id, resourceType, resourceId,
    );
    if (!roles.length) return null;
    // none 优先：任意一条 none 记录 → 直接返回 none（显式拒绝）
    if (roles.some(r => r.role === 'none')) return 'none';
    return findHighestRole(roles);
  }
}
```

### 4.3 角色 → Ability 映射

复用现有 build 函数，新增 `none` 分支：

```typescript
function buildAbilityByRole(role: string): MongoAbility<ISpaceAbility> {
  switch (role) {
    case 'admin':  return buildSpaceAdminAbility();
    case 'writer': return buildSpaceWriterAbility();
    case 'reader': return buildSpaceReaderAbility();
    case 'none':   return buildNoneAbility();
    default:       throw new NotFoundException('Unknown role');
  }
}

function buildNoneAbility() {
  const { build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(createMongoAbility);
  return build(); // 空 ability，所有操作 cannot
}
```

### 4.4 Factory 共存关系

```
SpaceAbilityFactory    → Space 级操作（空间设置、成员管理），不改
ResourceAbilityFactory → Directory/Page 级操作（内容读写），新增
```

---

## 5. API 层

### 5.1 新增端点

| 端点 | 方法 | 用途 | 权限要求 |
|------|------|------|---------|
| `/api/resource-permissions/list` | POST | 查询资源的所有 override | 资源 admin |
| `/api/resource-permissions/add` | POST | 添加 override | 资源 admin |
| `/api/resource-permissions/update` | POST | 修改角色 | 资源 admin |
| `/api/resource-permissions/remove` | POST | 移除 override | 资源 admin |
| `/api/resource-permissions/resolve` | POST | 查询有效权限 | 工作区 ADMIN 或资源 admin |

请求体格式：

```typescript
// list
{ resourceType: 'directory' | 'page'; resourceId: string }

// add
{ resourceType: 'directory' | 'page'; resourceId: string;
  principalType: 'user' | 'group'; principalId: string; role: string }

// update
{ id: string; role: string }

// remove
{ id: string }

// resolve - 查询自己的有效权限（userId 从 JWT 提取，不接受请求体传入）
{ resourceType: 'directory' | 'page'; resourceId: string }
// resolve - 工作区 ADMIN 查询他人权限（需先验证调用者是工作区 ADMIN）
{ resourceType: 'directory' | 'page'; resourceId: string; userId: string }
```

服务端实现：若请求体含 `userId` 且与当前用户不同，先验证调用者是工作区 ADMIN，否则 403。服务端自动从 DB 加载 `directoryId`/`spaceId`。

安全约束：
- 不能给自己设置 `none`（防止自锁）
- 不能移除资源的最后一个 `admin`（防止孤儿资源）
- `resolve` 端点查询他人权限仅限工作区 ADMIN（防止权限枚举）

### 5.2 现有端点改造

切换到 ResourceAbilityFactory 的端点：

| 端点 | 现有检查 | 改造后 |
|------|---------|--------|
| `pages/create` | SpaceAbility Manage Page | ResourceAbility(目标 directory) Edit；无 directoryId 时降级到 SpaceAbility |
| `pages/info` | SpaceAbility Read Page | ResourceAbility(page) Read |
| `pages/update` | SpaceAbility Edit Page | ResourceAbility(page) Edit |
| `pages/delete` | SpaceAbility Manage Page | ResourceAbility(page) Manage |
| `pages/move` | SpaceAbility Edit × 2 | 源+目标 ResourceAbility |
| `pages/duplicate` | SpaceAbility Edit × 2 | 源+目标 ResourceAbility |
| `directories/update` | SpaceAbility Manage Settings | ResourceAbility(directory) Manage |
| `directories/delete` | SpaceAbility Manage Settings | ResourceAbility(directory) Manage |
| `comments/create` | SpaceAbility Create Page | ResourceAbility(page) Create |
| `comments/update` | SpaceAbility Edit Page | ResourceAbility(page) Edit |
| `comments/delete` | SpaceAbility Edit Page | ResourceAbility(page) Edit |
| `attachments/upload` | SpaceAbility Edit Page | ResourceAbility(page) Edit；从请求体 pageId 获取上下文 |
| `export/page` | SpaceAbility Read Page | ResourceAbility(page) Read |
| `shares/create` | SpaceAbility Create Share | ResourceAbility(page) Manage |

不改的端点（继续用 SpaceAbilityFactory）：
- `spaces/*`（空间设置、成员管理）
- `directories/create`（Space Admin 权限）
- 工作区级操作

### 5.3 Hocuspocus 认证改造

```typescript
// authentication.extension.ts
// 现有：const spaceRole = findHighestUserSpaceRole(roles);
// 改造后：
const effectiveRole = await resourceAbilityFactory.resolveRole(
  user, 'page', pageId,
  { directoryId: page.directoryId, spaceId: page.spaceId },
);
// role='none' → 抛出 UnauthorizedException，拒绝连接（不可见 = 不可连接）
// role='reader' → readOnly = true（可看不可编辑）
// role='admin' 或 'writer' → readOnly = false
```

---

## 6. Wiki 公开权限

### 6.1 公开性控制升级

三层控制链：

```
1. resource_permissions 有 role='none'（对默认全员组） → 资源对 Wiki 不可见
2. space.visibility = 'OPEN' → 空间对 Wiki 可见
3. 环境变量 WIKI_PUBLIC_SPACE_SLUGS → fallback（兼容期后可废弃）
```

```typescript
// public-wiki.service.ts
async isSpacePublic(slug: string, workspaceId: string): Promise<boolean> {
  const space = await spaceRepo.findBySlug(slug, workspaceId);
  if (!space) return false;
  
  // 优先查数据库（Step 0 预迁移后，公开空间已写入 visibility=OPEN）
  if (space.visibility === SpaceVisibility.OPEN) return true;
  
  // fallback：兼容尚未执行 Step 0 的部署
  // 仅当环境变量显式配置时才生效；未配置 = 安全默认（不公开）
  const envSlugs = this.env.getPublicSpaceSlugs();
  if (envSlugs === undefined || envSlugs === null) return false; // 未配置 → 不公开
  if (envSlugs.length === 0) return true; // 显式空列表 → 全部公开（保持现有行为）
  return envSlugs.includes(slug.toLowerCase());
}
```

> **安全默认原则**：环境变量未设置时返回 false（不公开），而非 true。只有显式配置空列表（`WIKI_PUBLIC_SPACE_SLUGS=`）才触发全部公开的兼容行为。

### 6.2 侧边栏过滤

**Wiki 公开前端**：

```typescript
async getSidebarTree(spaceId: string, workspaceId: string) {
  const tree = await pageRepo.getSidebarTree(spaceId);
  const hiddenResources = await resourcePermRepo.findHiddenForPublic(spaceId, workspaceId);
  return filterTree(tree, hiddenResources);
}
```

**Docmost 后台**：

```typescript
async getSidebarTree(user: User, spaceId: string) {
  const tree = await pageRepo.getSidebarTree(spaceId);
  const userOverrides = await resourcePermRepo.getUserOverrides(user.id, spaceId);
  return filterTreeForUser(tree, userOverrides, userSpaceRole);
}
```

### 6.3 搜索与 AI 问答

RetrievalScope 扩展：

```typescript
interface RetrievalScope {
  isPublicWiki: boolean;
  allowedSpaceIds: string[];
  excludedDirectoryIds: string[];  // 新增
  excludedPageIds: string[];       // 新增
  currentPageId?: string;
}
```

AI 搜索 SQL 追加 `AND p.id NOT IN (:excludedPageIds) AND p.directory_id NOT IN (:excludedDirectoryIds)`。

---

## 7. 前端改造

### 7.1 权限数据结构

```typescript
// apps/client/src/features/space/permissions/permissions.type.ts

export interface ResourcePermission {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canManage: boolean;
  effectiveRole: 'admin' | 'writer' | 'reader' | 'none';
  isOverridden: boolean;
}
```

### 7.2 权限查询 Hook

```typescript
// apps/client/src/features/space/permissions/use-resource-permission.ts

export function useResourcePermission(
  resourceType: 'directory' | 'page',
  resourceId: string | undefined,
) {
  return useQuery({
    queryKey: ['resource-permission', resourceType, resourceId],
    queryFn: () => api.post('/resource-permissions/resolve', { resourceType, resourceId }),
    enabled: !!resourceId,
    staleTime: 5 * 60 * 1000,
  });
}
```

### 7.3 组件改造

| 组件 | 现状 | 改造 |
|------|------|------|
| PageEditor | `editable: boolean` | `editable: permission.canEdit` |
| PageHeaderMenu | `readOnly: boolean` 全局开关 | 按 canEdit/canDelete/canShare/canManage 分别控制 |
| SpaceSidebar | 渲染全部页面 | 过滤 canView=false 的节点 |
| CommentList | spaceAbility.can(Manage, Page) | permission.canEdit |
| PageHistoryRestore | spaceAbility.can(Manage, Page) | permission.canEdit |

### 7.4 Directory 权限管理 UI

在空间设置「目录」Tab 中，每行增加权限管理按钮（👥），点击打开 Modal：

```
┌─ 应用系统 - 权限管理 ─────────────────────────┐
│                                                 │
│  🔔 未设置权限覆盖，继承空间权限                │
│                        [+ 添加成员/群组]        │
│                                                 │
│  成员             角色            操作          │
│  ──────────────────────────────────────         │
│  张三             可以编辑  ▾     🗑️            │
│  OBG(群组)        可以查看  ▾     🗑️            │
│  李四             无权限    ▾     🗑️            │
│                                                 │
│                        [清除覆盖，恢复继承]     │
└─────────────────────────────────────────────────┘
```

### 7.5 Page 权限入口

页面操作菜单（··· 下拉）中新增「权限管理」项，仅 canManage=true 时显示。

### 7.6 Wiki 可见性开关

空间设置「设置」Tab 中，「禁用公开分享」下方新增：

```
Wiki 公开可见                         ● (开关)
允许此空间在公开知识库(Wiki)中展示。
```

---

## 8. 文件清单

### 8.1 新增文件

```
apps/server/src/core/resource-permission/
├── resource-permission.module.ts
├── resource-permission.controller.ts
├── resource-permission.service.ts
└── dto/
    ├── add-resource-permission.dto.ts
    ├── update-resource-permission.dto.ts
    ├── remove-resource-permission.dto.ts
    ├── list-resource-permission.dto.ts
    └── resolve-resource-permission.dto.ts

apps/server/src/core/casl/abilities/
└── resource-ability.factory.ts

packages/db/src/repos/resource-permission/
├── resource-permission.repo.ts
└── index.ts

packages/db/src/migrations/
└── 20260410T120000-resource-permissions.ts

apps/client/src/features/space/permissions/
├── use-resource-permission.ts
└── resource-permission-modal.tsx
```

### 8.2 修改文件

**后端**：

| 文件 | 改动 |
|------|------|
| `core/casl/casl.module.ts` | 注册 ResourceAbilityFactory |
| `core/casl/interfaces/space-ability.type.ts` | SpaceCaslSubject 新增 Directory |
| `common/helpers/types/permission.ts` | SpaceRole 新增 NONE |
| `core/page/page.controller.ts` | 内容端点改用 ResourceAbilityFactory |
| `core/comment/comment.controller.ts` | 评论端点改用 ResourceAbilityFactory |
| `core/share/share.controller.ts` | 分享端点改用 ResourceAbilityFactory |
| `core/attachment/attachment.controller.ts` | 上传端点改用 ResourceAbilityFactory |
| `integrations/export/export.controller.ts` | 导出端点改用 ResourceAbilityFactory |
| `features/directory/directory.controller.ts` | 目录操作改用 ResourceAbilityFactory |
| `collaboration/extensions/authentication.extension.ts` | Hocuspocus 三级解析 |
| `core/public-wiki/public-wiki.service.ts` | DB 驱动 + 侧边栏过滤 |
| `ee/ai/services/ai-search.service.ts` | RetrievalScope 新增 excluded 字段 |
| `app.module.ts` | imports 新增 ResourcePermissionModule |

**前端**：

| 文件 | 改动 |
|------|------|
| `features/space/permissions/permissions.type.ts` | 新增 ResourcePermission 接口 |
| `features/editor/page-editor.tsx` | editable 基于 ResourcePermission |
| `features/page/components/header/page-header-menu.tsx` | 按钮分别控制 |
| `features/space/components/settings-modal.tsx` | Wiki 可见性开关 |
| `features/space/components/directory-list.tsx` | 目录行增加权限按钮 |
| `features/space/components/sidebar/space-sidebar.tsx` | 接入过滤后数据 |

---

## 9. 迁移策略

### 9.1 四步上线

```
Step 0: 存量数据预迁移（Step 3 的前置条件）
  - 将环境变量中的公开空间写入数据库：
    UPDATE spaces SET visibility='open' 
    WHERE slug IN (当前 WIKI_PUBLIC_SPACE_SLUGS 列表)
  - 验证：迁移后 Wiki 可访问性不变
  - 此步骤在 Step 3 切换前执行，Step 1/2 不依赖

Step 1: 加表加 API（纯新增，零破坏）
  - resource_permissions 表 + CRUD API + ResourceAbilityFactory
  - 表为空时行为等价于现有逻辑

Step 2: 切换权限检查（逐端点）
  - Controller 从 SpaceAbilityFactory → ResourceAbilityFactory
  - 如有问题切回原 Factory

Step 3: 前端 UI + Wiki 改造（依赖 Step 0 已执行）
  - Directory/Page 权限管理 UI
  - 侧边栏过滤 + Wiki 数据库驱动公开控制
  - isSpacePublic 优先查 DB，环境变量作 fallback
```

### 9.2 向后兼容

- `resource_permissions` 表为空 → 行为与当前系统完全一致
- `space_members` 不迁移、不修改、不删除
- 环境变量 `WIKI_PUBLIC_SPACE_SLUGS` 保留为 fallback
- 现有 API 请求/响应格式不变

### 9.3 回滚方案

- Step 0 回滚：无需回滚（visibility=OPEN 不影响现有逻辑，环境变量仍生效）
- Step 1 回滚：DROP TABLE resource_permissions
- Step 2 回滚：Controller import 切回 SpaceAbilityFactory
- Step 3 回滚：前端 revert，Wiki fallback 到环境变量

---

## 10. Future 项

| 项目 | 依赖 |
|------|------|
| WebSocket 实时权限撤销 | Step 2 |
| 页面移动/复制递归权限检查 | Step 2 |
| 分享链接权限同步失效 | Step 2 |
| COMMENTER 角色 | Step 3 |
| 评论细粒度权限 | COMMENTER |
| API Key scopes | 无 |
| 权限变更审计日志 | Step 1 |
| Redis 权限缓存 | Step 2 |
| Topic 级权限（加 resource_type='topic'） | Step 2 |
| 批量权限管理 API | Step 1 |
