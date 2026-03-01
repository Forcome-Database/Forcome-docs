# Wiki 前台目录展示设计

> 日期: 2026-02-28
> 分支: feater-dir-refactor
> 状态: 已批准

## 需求概述

Wiki 前台（VitePress）需要支持目录/主题层级展示：
- 空间作为顶层导航，有目录时在空间名称下方显示目录下拉列表
- 点击目录 → 左侧边栏显示该目录下的主题（分组标题）和页面
- 空间无目录时保持当前行为（直接展示页面）
- 点击空间名（有目录时）→ 自动选中第一个目录

## 实现方案

采用 **方案 A：后端新增 API 端点 + 前端按需加载**。

## 后端改动

### 1. `POST /api/public-wiki/spaces` — 增加 hasDirectories

返回每个空间是否包含目录，用于前端判断是否显示下拉箭头。

```json
{ "items": [{ "id": "...", "name": "IBU文档", "slug": "ibu", "hasDirectories": true }] }
```

### 2. 新增 `POST /api/public-wiki/directories`

请求: `{ spaceSlug: string }`
返回: `{ items: [{ id, name, slug, icon?, position }] }`

从 directories 表查询，过滤 deletedAt=null，按 position 排序。

### 3. 修改 `POST /api/public-wiki/sidebar`

新增可选参数 `directoryId`。

传入 directoryId 时：
- 查询该目录下的 topics + pages
- 返回带 nodeType 的混合树（topic 节点包含其下页面，无 topic 的页面直接列出）
- 排序保持后端 Docmost 中的顺序

不传 directoryId 时：保持现有行为。

返回结构:
```json
{
  "space": { "id", "name", "slug" },
  "directory": { "id", "name" },
  "items": [
    { "nodeType": "topic", "id", "name", "icon", "children": [{ "nodeType": "page", ... }] },
    { "nodeType": "page", "id", "slugId", "title", "icon", "hasChildren", "children": [] }
  ]
}
```

## 前端改动

### 1. 类型扩展 (types/index.ts)

- 新增 `DocmostDirectory` 接口
- `DocmostSpace` 增加 `hasDirectories?: boolean`
- `DocmostSidebarNode` 增加 `nodeType?: 'topic' | 'page'` 和 `name?: string`

### 2. API 服务 (services/docmost.ts)

- 新增 `getDirectories(spaceSlug)` 方法
- `getSidebar` 增加可选 `directoryId` 参数

### 3. Composable (useDocmostSidebar.ts)

新增状态:
- `directories: Record<string, DocmostDirectory[]>` — 按 spaceSlug 缓存
- `selectedDirectory: Record<string, string>` — 当前选中目录 ID

新增方法:
- `loadDirectories(spaceSlug)` — 加载目录列表
- `selectDirectory(spaceSlug, directoryId)` — 选择目录并重载侧边栏

修改逻辑:
- `loadSpaces()` 后，对 hasDirectories=true 的空间自动加载目录
- `mapToSidebarItems` 识别 nodeType='topic' → 映射为分组标题（无 link）
- `buildSidebarForRoute` 使用选中的目录过滤

### 4. NavBar (NavBar.vue)

- 有目录的空间：复用现有 `.nav-dropdown` 组件，items 为目录列表
- 点击目录：调用 `selectDirectory`，导航到空间路由
- 无目录空间：保持普通链接

### 5. 数据流

```
初始化: loadSpaces() → 有目录? → loadDirectories() → 自动选第一个 → loadSidebar(spaceSlug, dirId)
切换目录: NavBar 点击 → selectDirectory() → loadSidebar() → SideBar 更新
无目录空间: 点击 → loadSidebar(spaceSlug) → 传统页面树
```

## 文件变更清单

### 后端 (apps/server/src/core/public-wiki/)
- `public-wiki.service.ts` — 新增 getDirectories(), 修改 getSidebarTree()
- `public-wiki.controller.ts` — 新增 directories 端点
- `dto/public-wiki.dto.ts` — 新增 PublicDirectoriesDto

### 前端 (wiki/docs/.vitepress/theme/)
- `types/index.ts` — 新增 DocmostDirectory, 扩展现有类型
- `services/docmost.ts` — 新增 getDirectories(), 修改 getSidebar()
- `composables/useDocmostSidebar.ts` — 核心逻辑改动
- `components/NavBar.vue` — 目录下拉菜单
- `components/SideBar.vue` — 可能需微调（主要逻辑在 composable 中）
