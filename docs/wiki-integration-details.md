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
| `apps/server/src/main.ts` | 直接 `await` 注册 `@fastify/cors` + `/api/public-wiki` 加入 excludedPaths |

### API 端点

所有端点使用 `@Public()` 装饰器免认证，通过 `@AuthWorkspace()` 获取工作区上下文。

| 端点 | 请求体 | 说明 |
|------|--------|------|
| `POST /api/public-wiki/spaces` | 无 | 返回公开空间列表 |
| `POST /api/public-wiki/sidebar` | `{ spaceSlug }` | 返回空间的递归页面树 |
| `POST /api/public-wiki/page` | `{ slugId?, pageId?, format? }` | 返回页面 HTML/Markdown 内容 |
| `POST /api/public-wiki/search` | `{ query, spaceSlug?, limit? }` | 全文搜索公开页面 |
| `POST /api/public-wiki/ai/answers` | `{ query, pageSlugId? }` | AI 问答（SSE 流式响应，可指定当前页面上下文） |

### 服务层核心逻辑

**`PublicWikiService`** 主要方法：

- **`getPublicSpaces()`** — 查询 `spaces` 表。slugs 为空时返回所有空间（自动发现），有值时按白名单过滤（大小写不敏感）
- **`getSidebarTree()`** — 查询空间全部页面，`buildTree()` 递归构建树结构（按 `position` 排序）
- **`getPage()`** — 查找页面并验证属于公开空间，处理附件公开 URL，生成 HTML/Markdown
- **`searchPublicPages()`** — 遍历公开空间调用 `SearchService.searchPage()`，合并排序
- **`aiAnswers(query, workspaceId, pageSlugId?)`** — 通过 `ModuleRef` 动态获取 EE 的 `AiSearchService`，传递可选的当前页面 slugId，yield SSE 流
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

### 新建文件清单（5 个）

| 文件 | 说明 |
|------|------|
| `wiki/docs/.vitepress/theme/services/docmost.ts` | Docmost API 服务类 |
| `wiki/docs/.vitepress/theme/composables/useDocmostSidebar.ts` | 动态侧边栏 composable |
| `wiki/docs/.vitepress/theme/composables/useCodeCopy.ts` | 代码块复制功能（事件委托模式） |
| `wiki/docs/.vitepress/theme/components/DocmostContent.vue` | 动态内容渲染组件 |
| `wiki/docs/.vitepress/theme/utils/markdown.ts` | markdown-it + highlight.js 单例，AI 聊天 Markdown 渲染 |

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
- `aiAnswers(query, pageSlugId?)` — AsyncGenerator 模式消费 SSE 流，可传递当前页面 slugId 以获取精准上下文
- `abort()` — AbortController 取消进行中的请求

### AI 聊天 Markdown 渲染

`AIChat.vue` 使用 `markdown-it` + `highlight.js` 替换了原有的正则解析。核心模块：

- **`utils/markdown.ts`** — `markdown-it` 单例配置（`breaks: true`, `html: false`, `linkify: true`），集成 `highlight.js` core（注册 js/ts/python/bash/json/sql/html/css/java），自定义 code fence 输出带 header + 语言标签 + 复制按钮的结构，链接默认 `target="_blank"`
- **`composables/useCodeCopy.ts`** — 事件委托模式在消息容器上监听 `.code-copy-btn` 点击，从 `data-code` 属性读取代码内容，复制后图标切换为对勾 2 秒
- **`AIChat.vue`** — Bubble 角色配置（assistant: `borderless` + logo avatar），流式光标（`.is-streaming` + CSS `::after` 闪烁），highlight.js light/dark 双主题 token 颜色

> **依赖说明**：`markdown-it` 和 `highlight.js` 均为 VitePress 传递依赖，无需额外安装。

### 按页面隔离会话

AI 聊天会话按页面路径隔离存储，每个文档页面有独立的对话历史：

- **Storage key**: `cursor-docs-chat-history:{routePath}`（如 `cursor-docs-chat-history:/zh/docs/general/abc123`）
- **路由监听**: `watch(route.path)` 检测页面切换，自动加载对应会话
- **清空历史**: 仅清除当前页面的对话

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
   → getCurrentPageSlugId() 从路由提取当前页面 slugId
   → DocmostService.aiAnswers(query, pageSlugId) SSE 流
   → 后端 answerWithContext(query, workspaceId, pageSlugId)
     → 查询当前页面 text_content 作为主上下文（4000字符）
     → 向量搜索补充上下文（去重当前页面）
     → AI prompt 标注"当前页面"优先级
   → AsyncGenerator yield 逐块内容
   → markdown-it + highlight.js 实时渲染
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

---

## 特殊内容块渲染

Docmost 后端通过 `jsonToHtml()` 将 TipTap JSON 序列化为 HTML，但部分内容类型需要客户端二次处理才能正常显示。Wiki 前台通过 `useContentProcessor.ts` 实现两阶段内容处理。

### 新建文件（1 个）

| 文件 | 说明 |
|------|------|
| `wiki/docs/.vitepress/theme/composables/useContentProcessor.ts` | 内容处理器（URL 重写 + 特殊块渲染） |

### 修改文件（2 个）

| 文件 | 修改内容 |
|------|---------|
| `wiki/docs/.vitepress/theme/components/DocmostContent.vue` | 集成两阶段处理，添加主题切换监听 |
| `wiki/package.json` | 新增 `katex` 依赖 |

### 阶段 1：HTML 字符串预处理（v-html 之前）

**附件 URL 绝对化** — `rewriteAttachmentUrls(html)`

后端返回的 HTML 中附件路径是相对路径（如 `/api/files/attachment/{id}/download?token=xxx`），在 Wiki 域名下无法解析。从 `VITE_DOCMOST_API_URL` 提取 origin，将所有相对路径替换为绝对路径。

```
VITE_DOCMOST_API_URL = http://localhost:3000/api/public-wiki
提取 origin = http://localhost:3000

/api/files/public/xxx → http://localhost:3000/api/files/public/xxx
```

正则匹配 `src="/`、`href="/`、`data-src="/"` 开头的 `/files/` 或 `/api/files/` 路径。影响节点：image、video、attachment、excalidraw、drawio。

### 阶段 2：DOM 后处理（v-html 注入后）

`processSpecialBlocks(container)` 在 `nextTick()` 后执行，处理三类特殊块：

#### Mermaid 图表

- **选择器**：`pre > code.language-mermaid`
- **处理**：懒加载 `mermaid`，调用 `mermaid.render(id, source)` 生成 SVG，替换原 `<pre>` 块为 `<div class="docmost-mermaid-rendered">`
- **主题跟随**：MutationObserver 监听 `<html>` 的 class 变化，主题切换时重新渲染

#### KaTeX 公式

- **选择器**：`[data-type="mathBlock"][data-katex]`、`[data-type="mathInline"][data-katex]`
- **处理**：懒加载 `katex`，提取元素文本内容，调用 `katex.renderToString(formula, { displayMode })`
- **CSS**：首次渲染时动态注入 KaTeX CDN 样式表

#### Embed 嵌入内容（YouTube、Google Sheets 等）

- **选择器**：`div[data-type="embed"]`
- **处理**：提取 `data-src` 属性，通过 provider 映射表将原始 URL 转换为可嵌入的 iframe URL，创建 `<iframe>` 替换原 `<a>` 链接
- **Provider 映射**：与 `packages/editor-ext/src/lib/embed-provider.ts` 保持同步

| Provider | 转换规则 |
|----------|---------|
| YouTube | `youtube.com/watch?v=xxx` → `youtube-nocookie.com/embed/xxx` |
| Vimeo | `vimeo.com/123` → `player.vimeo.com/video/123` |
| Google Sheets | 保持原 URL |
| Google Drive | `/file/d/{id}/...` → `/file/d/{id}/preview` |
| Figma | 包装为 `figma.com/embed?url=...&embed_host=docmost` |
| Loom | `loom.com/share/{id}` → `loom.com/embed/{id}` |
| Miro | `miro.com/app/board/{id}` → `miro.com/app/live-embed/{id}` |
| 其他 | 直接使用原 URL 作为 iframe src |

iframe 安全属性：`sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`、`loading="lazy"`

### 后端 HTML 输出格式速查

| 内容类型 | HTML 结构 | CSS 选择器 |
|---------|-----------|-----------|
| Mermaid | `<pre><code class="language-mermaid">...</code></pre>` | `pre > code.language-mermaid` |
| 数学公式（行内） | `<span data-type="mathInline" data-katex="true">...</span>` | `span[data-type="mathInline"][data-katex]` |
| 数学公式（块级） | `<div data-type="mathBlock" data-katex="true">...</div>` | `div[data-type="mathBlock"][data-katex]` |
| Embed | `<div data-type="embed" data-src="..." data-provider="..."><a>...</a></div>` | `div[data-type="embed"]` |
| 图片 | `<img src="/api/files/..." data-attachment-id="...">` | `img[data-attachment-id]` |
| 视频 | `<video src="/api/files/..." data-attachment-id="...">` | `video[data-attachment-id]` |
| 附件下载 | `<div data-type="attachment"><a class="attachment" href="/api/files/...">...</a></div>` | `div[data-type="attachment"]` |
| Draw.io | `<div data-type="drawio" data-src="..."><img src="/api/files/..."></div>` | `div[data-type="drawio"]` |
| Excalidraw | `<div data-type="excalidraw" data-src="..."><img src="/api/files/..."></div>` | `div[data-type="excalidraw"]` |

---

## Wiki 渲染格式可切换（HTML / Markdown）

管理员可在 Docmost 工作区设置中切换 Wiki 前台的渲染格式（HTML 或 Markdown），所有匿名访客都受此设置影响。

### 数据流

```
1. 管理员在 Docmost「设置 > 工作区 > General」切换 wikiRenderFormat
2. 前端调用 POST /api/workspace/update { wikiRenderFormat: 'markdown' }
3. 后端 WorkspaceService.update() → WorkspaceRepo.updateWikiSettings()
4. 存储到 workspaces.settings.wiki.renderFormat（JSONB）
5. Wiki 前台首次加载时 POST /api/public-wiki/settings 获取设置
6. DocmostContent.vue 根据设置请求对应 format 并选择渲染路径
```

### 后端修改文件（5 个）

| 文件 | 修改内容 |
|------|---------|
| `apps/server/src/database/repos/workspace/workspace.repo.ts` | 新增 `updateWikiSettings()` 方法（仿 `updateAiSettings`），操作 `settings.wiki.{prefKey}` JSONB 路径 |
| `apps/server/src/core/workspace/dto/update-workspace.dto.ts` | 新增 `wikiRenderFormat: string` 可选字段 |
| `apps/server/src/core/workspace/services/workspace.service.ts` | `update()` 方法中新增 `wikiRenderFormat` 处理分支 |
| `apps/server/src/core/public-wiki/public-wiki.controller.ts` | 新增 `POST /api/public-wiki/settings` 公开端点 |
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | 新增 `getSettings()` 方法，返回 `{ wiki: { renderFormat } }`，默认 `'html'` |

### 新增 API 端点

| 端点 | 请求体 | 说明 |
|------|--------|------|
| `POST /api/public-wiki/settings` | 无 | 返回 Wiki 公开设置（目前仅 `wiki.renderFormat`） |

### Docmost 前端修改文件（3 个）

| 文件 | 修改内容 |
|------|---------|
| `apps/client/src/features/workspace/types/workspace.types.ts` | 新增 `IWorkspaceWikiSettings` 接口、`IWorkspace.wikiRenderFormat` 字段 |
| `apps/client/src/features/workspace/components/settings/components/wiki-render-format-pref.tsx` | **新建**，SegmentedControl 组件（HTML / Markdown），仅管理员可操作 |
| `apps/client/src/pages/settings/workspace/workspace-settings.tsx` | WorkspaceNameForm 后添加 Divider + WikiRenderFormatPref |

### Wiki 前端修改文件（4 个）

| 文件 | 修改内容 |
|------|---------|
| `wiki/docs/.vitepress/theme/services/docmost.ts` | 新增 `getSettings()` 方法 |
| `wiki/docs/.vitepress/theme/components/DocmostContent.vue` | 新增 `renderFormat` ref + 模块级缓存 + `loadRenderFormat()`；`processedContent` 根据格式选择渲染路径；新增 HTML 模式 CSS（TipTap taskList / callout） |
| `wiki/docs/.vitepress/theme/composables/useContentProcessor.ts` | 新增 `addHeadingIds()` 为标题自动生成锚点 ID（TOC 依赖） |
| `wiki/docs/.vitepress/theme/styles/markdown.css` | 覆盖 VitePress `.vp-doc` 表格默认样式 |

### 额外修改文件（1 个）

| 文件 | 修改内容 |
|------|---------|
| `packages/editor-ext/src/lib/markdown/utils/turndown.utils.ts` | `listParagraph` 规则增加 `TH`/`TD` 排除，避免表格单元格 `<p>` 被加入多余换行 |

### 渲染路径对比

| 步骤 | HTML 模式 | Markdown 模式 |
|------|-----------|---------------|
| API 请求 | `getPage(slugId, 'html')` | `getPage(slugId, 'markdown')` |
| 后端转换 | `jsonToHtml(prosemirrorJson)` | `jsonToHtml()` → `htmlToMarkdown()` |
| 前端处理 | `rewriteAttachmentUrls(html)` → v-html | `rewriteAttachmentUrls(md)` → `renderMarkdownToHtml()` → v-html |
| DOM 后处理 | `addHeadingIds()` + `processSpecialBlocks()` | 同左 |
| Callout 样式 | `div[data-type="callout"][data-callout-type]` | `.custom-block.info/.tip/.warning/.danger` |
| 任务列表样式 | `ul[data-type="taskList"]` + `li > label > input` | `.task-list-item` + `input[type="checkbox"]` |

### 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 设置级别 | 工作区级别 | Wiki 是公开匿名访问，无法识别用户偏好 |
| 默认值 | `html` | 向后兼容，不改变现有行为 |
| 权限 | 仅管理员 | 影响所有访客，需要管理员权限 |
| 设置缓存 | Wiki 前台模块级变量 | 避免每个页面都请求 settings API |
| Heading ID | DOM 后处理统一生成 | 两种模式都需要 ID 供 TOC 使用，markdown-it 默认不生成 heading ID |
