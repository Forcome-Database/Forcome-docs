# Wiki 权限统一设计

## 需求

Wiki 前端显示的空间、目录、页面可见性必须与 Docmost 后台一致。Wiki 强制钉钉登录，所有用户都已认证。

## 当前架构问题

Wiki 有两套独立的权限系统：

- **Docmost 内部**：`space_members` 角色 + `resource_permissions` 三级解析 — 完整的基于用户身份的权限控制
- **Wiki 公共端点**：`@Public()` 无认证 + `visibility` 字段 + `findHiddenForPublic` group NONE 查询 — 独立的全局开关

Wiki 用户通过钉钉登录后已获得标准 Docmost JWT（`authToken` httpOnly cookie），但 `DocmostService.post()` 没有 `credentials: 'include'`，后端 `public-wiki` 端点也全部 `@Public()` 跳过认证。导致后端不知道"谁在看"，无法按用户权限过滤。

## 环境配置与 Cookie 分析

### 环境矩阵

| 环境 | Docmost | Wiki 页面 | Wiki API 目标 | Cookie 场景 |
|------|---------|----------|-------------|------------|
| 开发 | `http://192.168.17.26:3000` | `http://192.168.17.26:5175` | `http://192.168.17.26:3000/api/public-wiki` | 同域名不同端口 |
| 生产 | `https://docs-admin.forcome.com` | `https://docs.forcome.com` | `https://docs-admin.forcome.com/api/public-wiki` | 不同子域名 |

### Cookie 行为分析

**钉钉登录流程**：Wiki 前端调用 `docs-admin.forcome.com/api/auth/dingtalk/callback` → 后端设置 `authToken` cookie（httpOnly, SameSite=Lax, domain 由 `COOKIE_DOMAIN` 决定）。

**Wiki API 调用**：`DocmostService.post()` 请求 `docs-admin.forcome.com/api/public-wiki/*`。

| 环境 | 页面源 | 请求目标 | 同站？ | SameSite=Lax 允许 POST？ | 需要配置 |
|------|--------|---------|-------|------------------------|---------|
| **开发** | `192.168.17.26:5175` | `192.168.17.26:3000` | ✅ same-site（同域名） | ✅ 是 | 只需 `credentials: 'include'` |
| **生产** | `docs.forcome.com` | `docs-admin.forcome.com` | ⚠️ 同 eTLD+1 但不同子域名 | ✅ 是（same-site = same eTLD+1） | `COOKIE_DOMAIN=.forcome.com` + `credentials: 'include'` |

**关键结论**：`docs.forcome.com` 和 `docs-admin.forcome.com` 属于同一个 eTLD+1（`forcome.com`），浏览器视为 **same-site**。`SameSite=Lax` 允许 same-site POST 请求携带 cookie。但需要 `COOKIE_DOMAIN=.forcome.com` 让 cookie 对两个子域名都可见。

### CORS 与 JWT

- CORS：`origin: true, credentials: true` — 已支持跨源携带 cookie
- JwtStrategy：优先从 `req.cookies.authToken` 提取 JWT，兼容 Authorization header

## 设计方案

### 核心改动：Wiki API 认证化，复用 Docmost 权限引擎

#### 1. Wiki 前端：请求携带 cookie

`wiki/docs/.vitepress/theme/services/docmost.ts` — `post()` 方法加 `credentials: 'include'`：

```typescript
const response = await fetch(`${this.config.baseUrl}/${endpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // ADD: 携带 authToken cookie
  body: JSON.stringify(body),
})
```

同时处理 401 响应——JWT 过期时重定向到登录页：

```typescript
if (response.status === 401) {
  // 清除过期的 auth 标记，重定向到登录页
  document.cookie = 'authMarker=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
  window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname)
  throw AppError.api('未登录或登录已过期')
}
```

AI SSE 请求（`aiAnswers` 方法）同样需要加 `credentials: 'include'`。

#### 2. 后端 public-wiki controller：移除 @Public()，注入用户

`public-wiki.controller.ts` — 各端点移除 `@Public()` 装饰器，加 `@AuthUser() user: User` 参数，传给 service。

**例外**：`settings` 端点可保留 `@Public()`（仅返回渲染格式配置，无敏感内容）。

#### 3. 后端 public-wiki service：用用户权限替换全局过滤

每个方法的改造逻辑：

**getSpaces(user, workspaceId)**
- 旧：查 `space.visibility='open'` 或环境变量白名单
- 新：查用户所属空间（`space_members` 直接 + 组成员）**UNION** `visibility='open'` 的空间（保持空间发现能力），排除已删除空间
- 注意：`getUserSpaces` 只返回已加入空间，需额外 UNION open 空间

**getDirectories(user, spaceSlug, workspaceId)**
- 旧：查 `directory.visibility='open'` + `findHiddenForPublic`
- 新：
  1. 验证用户有空间访问权（`space_members` 或 `visibility='open'`）
  2. 解析用户的 spaceRole
  3. 获取 `getUserOverridesInSpace` 覆盖数据
  4. spaceRole='none'（加法模式）：只返回有显式非 none 覆盖的目录
  5. 其他角色（减法模式）：返回全部目录，排除 none 覆盖的目录

**getSidebarTree(user, spaceSlug, workspaceId, directoryId)**
- 旧：`findHiddenForPublic` 过滤 + orphan re-parenting
- 新：
  1. 验证用户有空间访问权
  2. 解析 spaceRole + 覆盖数据
  3. 获取页面列表后做双模式过滤（与内部侧边栏同逻辑）
  4. 保留服务端树构建（Wiki 前端依赖完整树结构、topic 节点、excerpt 字段）
  5. 保留 orphan re-parenting 逻辑（用户级 NONE 覆盖的页面也会产生孤儿）

**getPage(user, opts, workspaceId)**
- 旧：`isSpacePublic` + `findHiddenForPublic`
- 新：
  1. `ResourceAbilityFactory.resolveRole(user, 'page', pageId, { directoryId, spaceId })` — 三级解析
  2. 有 Read 权限 → 继续处理
  3. 无权限 → 404
  4. **保留** `updatePublicAttachments`（Wiki 需要签名 URL 访问附件）
  5. 面包屑用 `getUserOverridesInSpace` 过滤隐藏祖先

**searchPages(user, query, workspaceId, ...)**
- 旧：`resolvePublicSpaces` + `findHiddenForPublic`
- 新：
  1. 搜索范围限定为用户可访问的空间
  2. 结果用 `ResourceVisibilityService.filterByPermissions(items, userId, workspaceId)` 过滤

**aiAnswers(user, input)**
- 旧：`resolvePublicPageScope` 构建匿名 scope（excludedPageIds/excludedDirectoryIds 来自 findHiddenForPublic）
- 新：从用户权限构建 scope（与已实现的内部 `/ai/answers` 同逻辑）
- 限流键从 IP 改为 `user.id`（更准确）
- 会话存储键从 `{sessionId}:{IP}` 改为 `{sessionId}:{userId}`（支持跨设备续接）

#### 4. 环境配置

**生产 `.env.prod` 加：**
```
COOKIE_DOMAIN=.forcome.com
```

**开发 `.env` 不需要改**（同域名不同端口，cookie 自动共享）。

#### 5. 可删除的代码

| 代码 | 文件 | 原因 |
|------|------|------|
| `isSpacePublic()` | public-wiki.service.ts | 用 space_members + visibility='open' UNION 替代 |
| `resolvePublicSpaces()` | public-wiki.service.ts | 同上 |
| `resolvePublicPageScope()` | public-wiki.service.ts | 用用户权限构建 scope 替代 |
| `getPublicSpaceSlugs()` | public-wiki.service.ts | 不再需要 |
| `WIKI_PUBLIC_SPACE_SLUGS` 相关逻辑 | environment.service.ts | 不再需要 |
| `directory.visibility` 字段 | 迁移文件 + db.d.ts + dto + service + 前端 | 用 resource_permissions 控制 |

**保留的代码：**

| 代码 | 原因 |
|------|------|
| `findHiddenForPublic()` | share 端点（`@Public()`）仍需要此方法 |
| `updatePublicAttachments()` | Wiki 仍需要签名 URL |
| `space.visibility` 字段 | 用于空间发现（open 空间 UNION 逻辑），保留不删 |
| `enforceOrigin()` | 纵深防御，保留 |
| orphan re-parenting 逻辑 | 用户级 NONE 覆盖也会产生侧边栏孤儿 |

#### 6. 不需要改的

| 组件 | 原因 |
|------|------|
| `ResourceAbilityFactory` | 直接复用三级解析 |
| `ResourcePermissionRepo.getUserOverridesInSpace` | 直接复用双模式过滤 |
| `SpaceMemberRepo` | 直接复用 |
| `ResourceVisibilityService` | 搜索过滤直接复用 |
| Docmost 前端权限管理 UI | 设置权限后 Wiki 自动生效 |
| 钉钉登录流程 | JWT 已可被 public-wiki 端点识别 |
| CORS 配置 | 已支持 credentials |
| Wiki 前端 Vue 组件 | sidebar、content、search 组件不需要改，只改 service 层 |

## 边界情况与处理

### 高优先级

#### E1. 空间发现：open 空间需额外 UNION

`getUserSpaces()` 只返回已加入空间，不含 `visibility='open'` 空间。

**处理**：`getSpaces` 查询改为：
```sql
SELECT * FROM spaces WHERE id IN (用户 space_members 的 spaceId)
UNION
SELECT * FROM spaces WHERE visibility = 'open' AND workspace_id = ?
```

这样用户既能看到已加入的空间，也能发现 open 空间——与 Docmost 内部行为一致（甚至更好，因为 Docmost 内部目前也没实现 open 空间发现，有 TODO 注释）。

#### E2. 生产环境 Cookie 跨域

`docs-admin.forcome.com` 和 `docs.forcome.com` 是不同子域名。钉钉登录的 cookie 默认只设在 `docs-admin.forcome.com` 上。

**处理**：`.env.prod` 加 `COOKIE_DOMAIN=.forcome.com`，让 cookie 对所有 `*.forcome.com` 子域名可见。钉钉登录的 `setAuthCookie` 已读取此配置。

#### E3. 401 响应处理

JWT 过期或无效时后端返回 401。当前 Wiki 前端不处理此状态码。

**处理**：`DocmostService.post()` 在 401 时清除 `authMarker` cookie 并重定向到 `/login`。

### 中优先级

#### E4. 附件签名 URL 必须保留

Wiki 通过签名 JWT URL 访问图片/附件。内部 Docmost API 不做此处理。

**处理**：`getPage` 保留 `updatePublicAttachments()` 逻辑不变。

#### E5. 侧边栏保留服务端树构建

内部 API 返回分页扁平列表，Wiki 依赖完整树结构（含 topic 节点、excerpt、hasChildren）。

**处理**：保留 `getSidebarTree` 的服务端树构建逻辑，只替换过滤数据源（从 `findHiddenForPublic` 改为 `getUserOverridesInSpace` 双模式）。

#### E6. AI 限流和会话改为用户级

当前用 IP 做限流键和会话键。认证后应用 user.id 更准确。

**处理**：
- 限流键：`ratelimit:public-wiki-ai:{workspaceId}:{userId}`
- 会话键：`{sessionId}:{userId}`

#### E7. 面包屑过滤适配

已实现的 Task 5 用 `hiddenPageIds`（来自 findHiddenForPublic）过滤。需改为用户级。

**处理**：改为用 `getUserOverridesInSpace` 获取用户的 NONE 覆盖来过滤。

### 低优先级

#### E8. 工作区管理员不绕过空间权限

工作区 ADMIN 如果不在 `space_members` 里，看不到该空间。

**处理**：与 Docmost 内部行为一致，暂不处理。如需改进属于权限模型升级，不在本次范围。

#### E9. 已实现 Tasks 的兼容性

| 已实现任务 | 状态 | 说明 |
|-----------|------|------|
| Task 1（share link check） | ✅ 保留 | share 端点独立，仍需 findHiddenForPublic |
| Task 2（export check） | ✅ 保留 | 内部 API，不受影响 |
| Task 3（member deletion cleanup） | ✅ 保留 | 清理逻辑对所有路径都需要 |
| Task 4（AI search scope） | ✅ 保留 | 内部 /ai/answers，不受影响 |
| Task 5（breadcrumbs filter） | ⚠️ 需适配 | Wiki 面包屑改为用 getUserOverridesInSpace |
| Task 6（sidebar orphan re-parenting） | ⚠️ 需适配 | 过滤源改为用户级 NONE 覆盖，但 re-parenting 逻辑本身保留 |
| Task 9（ResourceVisibilityService） | ✅ 保留 | Wiki 搜索可直接复用 |

## 影响评估

| 方面 | 影响 |
|------|------|
| 安全性 | 提升：从全局开关变为基于用户的精确权限控制 |
| 一致性 | 完全一致：Docmost 和 Wiki 用同一套权限引擎 |
| 复杂度 | 降低：删除独立的 visibility/findHiddenForPublic 系统 |
| 向后兼容 | Breaking change：未登录请求返回 401（Wiki 强制登录，无影响） |
| 性能 | 略有增加（每次请求 JWT 解析 + 权限查询），查询模式与内部 API 一致 |
| 部署 | 生产 `.env.prod` 加 `COOKIE_DOMAIN=.forcome.com` |

## 改动量估计

| 类别 | 文件数 | 说明 |
|------|--------|------|
| Wiki 前端 | 1 | docmost.ts 加 credentials + 401 处理 |
| 后端 controller | 1 | public-wiki.controller.ts 移除 @Public，加 @AuthUser |
| 后端 service | 1 | public-wiki.service.ts 替换全部过滤逻辑（最大改动） |
| 环境配置 | 1 | .env.prod 加 COOKIE_DOMAIN |
| 清理 directory.visibility | ~6 | 迁移文件、db.d.ts、dto、service、前端类型、前端组件 |
| 合计 | ~10 | |
