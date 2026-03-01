# Wiki 前台目录展示重构 — 实现细节

## 概述

对 Wiki（VitePress）前台的目录展示进行了全面重构，将 Docmost 后端的 **目录（Directory）→ 主题（Topic）→ 页面（Page）** 三层层级结构完整映射到 Wiki 前端，实现空间级导航、目录切换、主题分组、子页面卡片等功能。

## 核心变更

### 1. 导航栏目录下拉

**需求**：空间名称下若有目录，显示下拉列表；点击目录切换左侧侧边栏内容。

**实现**：
- `NavBar.vue` — 空间导航项根据 `hasDirectories` 生成下拉菜单
- 下拉项携带 `directoryId` / `spaceSlug` 元数据
- 点击事件调用 `selectDirectory()` 切换，同时 `event.preventDefault()` 阻止页面导航
- 无目录的空间保持原有行为（直接点击导航到空间）

**文件**：`wiki/docs/.vitepress/theme/components/NavBar.vue`

### 2. 侧边栏目录/主题分组

**需求**：侧边栏中主题显示为分组标题（无链接），页面显示为可点击项；切换目录时实时更新。

**实现**：
- `useDocmostSidebar.ts` — 核心 composable，管理目录/主题状态
  - `directories` / `selectedDirectoryId` — 模块级 `ref` 状态
  - `loadSpaces()` — 对有目录的空间自动加载目录列表并选中第一个
  - `selectDirectory()` — 切换目录，重新加载侧边栏数据
  - `mapToSidebarItems()` — 将 topic 节点映射为 VitePress `sidebar-group-title` 风格（`collapsed: undefined`）
  - `buildSidebarForRoute()` — 目录模式下主题作为顶层分组标题，无主题时用目录名作为分组标题

- `SideBar.vue` — 新增 `watch(sidebarData)` 监听目录切换时的数据变化并刷新

**文件**：
- `wiki/docs/.vitepress/theme/composables/useDocmostSidebar.ts`
- `wiki/docs/.vitepress/theme/components/SideBar.vue`

### 3. 自动跳转到第一篇文章

**需求**：进入空间、切换目录时自动显示第一篇文章，而非空白页。

**实现**：
- `DocmostContent.vue` — 新增自动跳转逻辑
  - `findFirstPageSlugId()` — 递归遍历侧边栏树，跳过 topic 节点，返回第一个页面的 slugId
  - `tryNavigateToFirstPage()` — 空间根路径自动跳转；切换目录后若当前页面不在新侧边栏中也自动跳转
  - `loadPage()` — 空间根路径时先检查侧边栏数据，有则立即跳转
  - `watch(sidebarData)` — 处理延迟加载（侧边栏数据后到达）和目录切换

**文件**：`wiki/docs/.vitepress/theme/components/DocmostContent.vue`

### 4. 子页面卡片网格

**需求**：Docmost 编辑器中插入的 `subpages` 子页面列表在 Wiki 中显示为 2 列卡片网格，包含图标、标题、摘要。

**问题根因**：TipTap 的 `subpages` 节点是原子节点，后端 `jsonToHtml` 只输出空占位符 `<div data-type="subpages"></div>`，实际子页面列表由 React 前端组件动态查询 API 渲染，Wiki 前端无对应处理。

**实现**：

后端：
- `public-wiki.service.ts` — 页面查询加入 `textContent` 字段，`buildTree` 输出节点新增 `excerpt`（截取 `textContent` 前 120 字符）

前端：
- `DocmostContent.vue` — DOM 后处理阶段
  - `findChildrenInSidebar()` — 在侧边栏树中查找当前页面的子页面
  - `processSubpagesBlocks()` — 检测 `div[data-type="subpages"]` 占位符，替换为卡片网格
  - 每张卡片：图标徽章（40px 圆角方形）+ 标题（17px 粗体）+ 摘要（15px 灰色，单行截断）
  - 2 列 grid 布局，移动端自动切为 1 列
  - hover 高亮边框 + 阴影，暗色模式适配

**文件**：
- `apps/server/src/core/public-wiki/public-wiki.service.ts`
- `wiki/docs/.vitepress/theme/components/DocmostContent.vue`
- `wiki/docs/.vitepress/theme/types/index.ts`

### 5. 上一页/下一页修复

**问题**：topic 节点（无 slugId）被混入扁平列表，导致上/下页导航出现空链接。

**修复**：`flattenTree` 只收集有 `slugId` 的页面节点，topic 仅作为容器递归其子节点。

**文件**：`wiki/docs/.vitepress/theme/components/DocmostContent.vue`

## 后端 API 变更

### 新增端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/public-wiki/directories` | POST | 获取空间下的目录列表 |

**请求**：`{ spaceSlug: string }`

**响应**：`{ items: [{ id, name, slug, icon, position }] }`

### 修改端点

| 端点 | 变更 |
|------|------|
| `/api/public-wiki/spaces` | 响应新增 `hasDirectories: boolean` |
| `/api/public-wiki/sidebar` | 请求新增可选 `directoryId`；响应节点新增 `nodeType`、`excerpt` |

### Sidebar 响应结构（目录模式）

```json
{
  "space": { "id": "...", "name": "...", "slug": "..." },
  "directory": { "id": "...", "name": "..." },
  "items": [
    {
      "nodeType": "topic",
      "id": "...", "name": "主题名", "icon": "🏷️",
      "children": [
        {
          "nodeType": "page",
          "id": "...", "slugId": "abc123", "title": "页面标题",
          "icon": "📄", "excerpt": "页面内容摘要...",
          "hasChildren": true,
          "children": [...]
        }
      ]
    },
    {
      "nodeType": "page",
      "id": "...", "slugId": "def456", "title": "未分类页面",
      "excerpt": "...", "hasChildren": false, "children": []
    }
  ]
}
```

## 新建/修改文件清单

### 后端

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/core/public-wiki/dto/public-wiki.dto.ts` | 修改 | 新增 `PublicDirectoriesDto`，`PublicSidebarDto` 加 `directoryId` |
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | 修改 | 新增 `getDirectories()`、`getDirectorySidebarTree()`；查询加 `textContent`，输出加 `excerpt` |
| `apps/server/src/core/public-wiki/public-wiki.controller.ts` | 修改 | 新增 `POST /directories` 端点 |

### 前端（Wiki）

| 文件 | 操作 | 说明 |
|------|------|------|
| `wiki/docs/.vitepress/theme/types/index.ts` | 修改 | `DocmostSidebarNode` 加 `nodeType`/`name`/`excerpt`；新增 `DocmostDirectory`；`DocmostSpace` 加 `hasDirectories` |
| `wiki/docs/.vitepress/theme/services/docmost.ts` | 修改 | 新增 `getDirectories()`；`getSidebar()` 加可选 `directoryId` |
| `wiki/docs/.vitepress/theme/composables/useDocmostSidebar.ts` | 修改 | 目录状态管理、自动选中、切换、分组构建逻辑 |
| `wiki/docs/.vitepress/theme/components/NavBar.vue` | 修改 | 目录下拉菜单、active 状态高亮 |
| `wiki/docs/.vitepress/theme/components/SideBar.vue` | 修改 | `watch(sidebarData)` 实时刷新 |
| `wiki/docs/.vitepress/theme/components/DocmostContent.vue` | 修改 | 自动跳转、子页面卡片、上下页修复 |

## 踩坑记录

### 1. 子页面 directoryId 不继承

**问题**：后端查询 `WHERE directoryId = X` 只获取直接分配到目录的页面，子页面通过 `parentPageId` 链接但不继承 `directoryId`。

**解决**：查询该空间所有页面，从 directIds 出发 BFS 收集所有后代页面。

### 2. topic 子页面 topicId 不继承

**问题**：`pages.filter(p => p.topicId === topic.id)` 传给 `buildTree` 后丢失子页面（子页面 topicId 为 null）。

**解决**：传入完整的 `pages` 数组给 `buildTree`，让它通过 `parentPageId` 链自行查找。

### 3. SideBar.vue 不响应目录切换

**问题**：`SideBar.vue` 只监听 `route.path` 和 `docmostLoaded`，切换目录不改变路由，`sidebarData` 更新后 `updateSidebar()` 不被调用。

**解决**：新增 `watch(sidebarData, ...)` 监听数据变化。

### 4. topic 渲染为可折叠项而非分组标题

**问题**：topic 节点设置了 `collapsed: false`，`SideBar.vue` 将其渲染为可折叠的 `SideBarItem`。

**解决**：topic 节点不设 `collapsed`（保持 `undefined`），走 `sidebar-group-title` 渲染路径。

### 5. subpages 占位符不渲染

**问题**：TipTap `subpages` 是原子节点，`jsonToHtml` 输出空 `<div data-type="subpages"></div>`。

**解决**：前端 DOM 后处理检测占位符，从侧边栏数据查找子页面并替换为卡片网格。

### 6. 上下页导航空链接

**问题**：`flattenTree` 将 topic 节点（无 slugId/title）也推入列表，导航链接为空。

**解决**：`flattenTree` 只收集有 `slugId` 的页面节点。

### 7. Windows msys bash 崩溃

**问题**：`git commit -m "$(cat <<'EOF'...EOF)"` heredoc 语法在 Windows msys-2.0.dll 中触发 fatal error。

**解决**：使用简单的 `-m "..."` 语法提交。

## 数据流

```
用户点击顶部空间 → NavBar 判断 hasDirectories
  ├─ 无目录 → 直接导航到空间页面
  └─ 有目录 → 显示目录下拉
      └─ 点击目录 → selectDirectory(spaceSlug, directoryId)
          ├─ API: POST /api/public-wiki/sidebar { spaceSlug, directoryId }
          ├─ 响应包含 topic + page 混合树
          ├─ sidebarData 更新 → SideBar.vue watch 触发刷新
          ├─ tryNavigateToFirstPage() → 跳转到第一篇文章
          └─ DocmostContent 加载页面 → processSubpagesBlocks() 渲染子页面卡片
```
