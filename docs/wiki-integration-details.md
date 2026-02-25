# Wiki × Docmost 深度集成 — 实现细节

## 概述

将 VitePress 知识库项目（`wiki/`）深度集成到 Docmost 中，作为 Docmost 的**公开只读前端**。Docmost 中创建和管理的文档内容可以在 Wiki 中免登录浏览、搜索和 AI 问答，Wiki 保持原有的 UI 样式和交互体验。

## 核心架构

```
浏览器 → Wiki (VitePress SPA) → Docmost Public API → PostgreSQL
                                       ↓
                                   AI Search (pgvector + LLM)
```

**关键特性**：
- 免登录公开访问（访问者无需 Docmost 账号）
- 侧边栏和内容由 Docmost API 动态驱动
- AI 问答使用 Docmost AI（RAG + 向量检索）
- 搜索使用 Docmost 全文搜索（PostgreSQL tsvector）
- 保持 Wiki 现有 UI、主题、多语言支持

## URL 结构

```
/{lang}/docs/{spaceSlug}/{pageSlugId}

示例：
/zh/docs/general/abc123      — General 空间某页面
/zh/docs/kingdee/def456      — 金蝶 ERP 某页面
/zh/docs/crm/ghi789          — CRM 某页面
/zh/docs/general/             — General 空间根路径（显示选择提示）
```

## 环境变量

### Docmost 后端 `.env`
```env
# 逗号分隔的公开空间 slug
# 留空 = 自动公开所有空间（自动发现模式）
# 填值 = 白名单模式，只公开指定空间
WIKI_PUBLIC_SPACE_SLUGS=
```

### Wiki 前端 `.env`（位于 `wiki/docs/.env`）
```env
# Docmost Public Wiki API 地址
VITE_DOCMOST_API_URL=http://localhost:3000/api/public-wiki
```

> **注意**：VitePress 的 env 文件由 Vite 的 `envDir` 配置决定，当前设置为 `process.cwd()`，即 wiki 根目录。需确保 `.env` 文件放在正确位置。

---

## 后端：新增 Public Wiki 模块

### 新建文件清单（4 个）

| 文件 | 说明 |
|------|------|
| `apps/server/src/core/public-wiki/public-wiki.module.ts` | 模块注册，导入 TokenModule + SearchModule |
| `apps/server/src/core/public-wiki/public-wiki.controller.ts` | 控制器，5 个 POST 端点 |
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | 业务逻辑，空间/页面/搜索/AI |
| `apps/server/src/core/public-wiki/dto/public-wiki.dto.ts` | 4 个 DTO 验证类 |

### 修改文件清单（4 个）

| 文件 | 修改内容 |
|------|---------|
| `apps/server/src/core/core.module.ts` | imports 添加 `PublicWikiModule` |
| `apps/server/src/core/search/search.module.ts` | exports 添加 `SearchService`（供 PublicWikiModule 注入） |
| `apps/server/src/integrations/environment/environment.service.ts` | 新增 `getWikiPublicSpaceSlugs()` 方法 |
| `apps/server/src/main.ts` | CORS 配置提前 + `/api/public-wiki` 加入 excludedPaths |

### API 端点

所有端点使用 `@Public()` 装饰器免认证，通过 `@AuthWorkspace()` 获取工作区上下文。

| 端点 | 请求体 | 说明 |
|------|--------|------|
| `POST /api/public-wiki/spaces` | 无 | 返回公开空间列表 |
| `POST /api/public-wiki/sidebar` | `{ spaceSlug }` | 返回空间的递归页面树 |
| `POST /api/public-wiki/page` | `{ slugId?, pageId?, format? }` | 返回页面 HTML/Markdown 内容 |
| `POST /api/public-wiki/search` | `{ query, spaceSlug?, limit? }` | 全文搜索公开页面 |
| `POST /api/public-wiki/ai/answers` | `{ query }` | AI 问答（SSE 流式响应） |

### 服务层核心逻辑

**`PublicWikiService`** 主要方法：

- **`getPublicSpaces()`** — 查询 `spaces` 表。slugs 为空时返回所有空间（自动发现），有值时按白名单过滤（大小写不敏感）
- **`getSidebarTree()`** — 查询空间全部页面，`buildTree()` 递归构建树结构（按 `position` 排序）
- **`getPage()`** — 查找页面并验证属于公开空间，处理附件公开 URL，生成 HTML/Markdown
- **`searchPublicPages()`** — 遍历公开空间调用 `SearchService.searchPage()`，合并排序
- **`aiAnswers()`** — 通过 `ModuleRef` 动态获取 EE 的 `AiSearchService`，yield SSE 流
- **`updatePublicAttachments()`** — 为页面附件生成临时签名 token（复用 `TokenService`）
- **`getPageBreadcrumbs()`** — PostgreSQL 递归 CTE 查询页面祖先链

### 权限与安全模型

```
@Public() 装饰器
    → JwtAuthGuard 跳过认证
    → DomainMiddleware 仍解析 workspaceId
    → @AuthWorkspace() 获取工作区上下文
    → PublicWikiService 限制只返回公开空间数据
    → 附件通过签名 token 临时授权访问
```

---

## 前端：Wiki 集成层

### 新建文件清单（3 个）

| 文件 | 说明 |
|------|------|
| `wiki/docs/.vitepress/theme/services/docmost.ts` | Docmost API 服务类 |
| `wiki/docs/.vitepress/theme/composables/useDocmostSidebar.ts` | 动态侧边栏 composable |
| `wiki/docs/.vitepress/theme/components/DocmostContent.vue` | 动态内容渲染组件 |

### 修改文件清单（7 个）

| 文件 | 修改内容 |
|------|---------|
| `wiki/docs/.vitepress/theme/index.ts` | 添加 `router.onBeforePageLoad` 路由拦截 |
| `wiki/docs/.vitepress/theme/Layout.vue` | 添加 Docmost 路由检测 + DocmostContent 渲染 |
| `wiki/docs/.vitepress/theme/components/SideBar.vue` | 融合静态+动态侧边栏数据源 |
| `wiki/docs/.vitepress/theme/components/NavBar.vue` | 动态合并静态导航+API空间；`isActive` 改用 `route.path` |
| `wiki/docs/.vitepress/theme/components/SearchModal.vue` | 集成 Docmost 搜索 API |
| `wiki/docs/.vitepress/theme/components/AIChat.vue` | 集成 Docmost AI 问答 |
| `wiki/docs/.vitepress/theme/types/index.ts` | 新增 Docmost 相关类型定义 |

### VitePress 路由拦截（核心机制）

VitePress 是文件驱动的静态站点生成器，路由必须对应 `.md` 文件。Docmost 动态内容没有 `.md` 文件，直接访问会触发 404。

**解决方案**：在 `theme/index.ts` 的 `enhanceApp` 中使用 `router.onBeforePageLoad` 钩子拦截 Docmost 路由：

```typescript
router.onBeforePageLoad = (to: string) => {
  if (isDocmostRoute(to)) {
    // 设置 relativePath 用于 locale 解析（关键！）
    const relativePath = to.replace(/^\//, '') + '/index.md'
    router.route.path = to
    router.route.component = markRaw(DocmostContent)
    router.route.data = {
      relativePath,    // ← 必须以 locale 前缀开头
      filePath: '',
      title: '',
      description: '',
      headers: [],
      frontmatter: { sidebar: true },
      params: {},
      isNotFound: false,
      lastUpdated: 0,
    } as any
    return false       // ← 阻止 VitePress 查找 .md 文件
  }
  return true
}
```

### 动态侧边栏

`useDocmostSidebar.ts` 使用**模块级别共享状态**：

```typescript
// 模块级（全局共享，避免重复加载）
const spaces = ref<DocmostSpace[]>([])
const sidebarData = ref<Record<string, DocmostSidebarNode[]>>({})
const isLoading = ref(false)
const isLoaded = ref(false)
```

`SideBar.vue` 通过 `watch` 监听路由和数据变化：
- 静态路由 → 读取 `theme.sidebar` 配置
- Docmost 路由 → 调用 `buildSidebarForRoute()` 从 API 数据构建

### 动态导航栏（自动发现空间）

`NavBar.vue` 通过 `useDocmostSidebar` 获取 API 返回的空间列表，与静态 `theme.nav` 配置合并：

1. 从静态 nav 所有 `link` 中提取已覆盖的 spaceSlug（匹配 `/{lang}/docs/{slug}/` 模式，包括下拉菜单子项）
2. 筛选出 API 空间中未被静态 nav 覆盖的空间
3. 为每个新空间生成导航项：`{ text: space.name, link: /{lang}/docs/{slug}/, activeMatch: ... }`
4. 动态项追加到静态项末尾

`isActive` 使用 `useRoute().path`（实际 URL 路径）替代 `page.value.relativePath`（VitePress 静态 .md 路径），解决 Docmost 动态路由导航高亮不工作的问题。

### API 服务层

`DocmostService` 封装所有 API 调用：
- `post<T>()` — 通用 POST 方法，自动解包 `TransformHttpResponseInterceptor` 的 `{ data, success, status }` 响应包装
- `aiAnswers()` — AsyncGenerator 模式消费 SSE 流
- `abort()` — AbortController 取消进行中的请求

### 数据流

```
1. 导航流程：
   用户访问 /zh/docs/general/abc123
   → onBeforePageLoad 拦截，注入 DocmostContent 组件
   → DocmostContent 解析 routeParams
   → 调用 DocmostService.getPage(slugId)
   → v-html 渲染 HTML 内容

2. 侧边栏流程：
   Layout.onMounted → useDocmostSidebar().loadSpaces()
   → 并行请求所有公开空间的页面树
   → sidebarData 更新
   → SideBar watch(docmostLoaded) 触发
   → buildSidebarForRoute() 构建 SidebarItem[]

3. 搜索流程：
   SearchModal 输入查询 → debounce(200ms)
   → DocmostService.search(query)
   → 结果映射为统一格式渲染

4. AI 问答流程：
   AIChat 输入问题
   → DocmostService.aiAnswers(query) SSE 流
   → AsyncGenerator yield 逐块内容
   → Markdown 实时渲染
```

---

## 部署方案

### 方案 A：同域部署（推荐）

```nginx
server {
  listen 80;

  # Wiki 静态文件
  location / {
    root /path/to/wiki/dist;
    try_files $uri $uri/ /index.html;  # SPA fallback
  }

  # Docmost API 反向代理
  location /api/ {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE 支持
    proxy_buffering off;
    proxy_cache off;
  }
}
```

同域部署时 `.env` 设置：`VITE_DOCMOST_API_URL=/api/public-wiki`

### 方案 B：跨域部署

Wiki 和 Docmost 不同域，需要 Docmost 启用 CORS（已在 `main.ts` 中配置 `origin: true`）。
