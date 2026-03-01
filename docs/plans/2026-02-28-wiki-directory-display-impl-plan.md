# Wiki 前台目录展示 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Wiki 前台支持目录/主题层级展示——空间有目录时顶部导航显示目录下拉列表，侧边栏按主题分组展示页面。

**Architecture:** 后端 public-wiki 模块新增 directories API 端点，修改 sidebar API 支持 directoryId 过滤并返回带 nodeType 的混合树；前端 useDocmostSidebar composable 增加目录状态管理，NavBar 复用现有下拉菜单组件展示目录列表。

**Tech Stack:** NestJS (后端 API)、Vue 3 + VitePress (前端)、Kysely (SQL 查询)

---

### Task 1: 后端 — 扩展 DTO 定义

**Files:**
- Modify: `apps/server/src/core/public-wiki/dto/public-wiki.dto.ts`

**Step 1: 添加 PublicDirectoriesDto 和修改 PublicSidebarDto**

在 `public-wiki.dto.ts` 文件末尾添加新 DTO，并给 `PublicSidebarDto` 增加可选的 `directoryId` 字段：

```typescript
// 修改 PublicSidebarDto —— 新增 directoryId 可选字段
export class PublicSidebarDto {
  @IsNotEmpty()
  @IsString()
  spaceSlug: string;

  @IsOptional()
  @IsString()
  directoryId?: string;
}

// 新增 —— 获取空间目录列表
export class PublicDirectoriesDto {
  @IsNotEmpty()
  @IsString()
  spaceSlug: string;
}
```

**Step 2: 提交**

```bash
git add apps/server/src/core/public-wiki/dto/public-wiki.dto.ts
git commit -m "feat(public-wiki): add PublicDirectoriesDto and extend PublicSidebarDto with directoryId"
```

---

### Task 2: 后端 — 扩展 PublicWikiService

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`

**Step 1: 修改 getPublicSpaces() 返回 hasDirectories**

在 `getPublicSpaces` 方法中，查询每个空间是否有目录：

```typescript
async getPublicSpaces(workspaceId: string) {
  const slugs = this.getPublicSpaceSlugs();

  let query = this.db
    .selectFrom('spaces')
    .select(['id', 'name', 'slug', 'description'])
    .where('workspaceId', '=', workspaceId);

  if (slugs.length > 0) {
    query = query.where((eb) =>
      eb.or(
        slugs.map((slug) =>
          eb(eb.fn('LOWER', ['slug']), '=', slug.toLowerCase()),
        ),
      ),
    );
  }

  const spaces = await query.execute();

  // 查询每个空间是否有目录
  const spaceIds = spaces.map((s) => s.id);
  const directoryCounts = spaceIds.length > 0
    ? await this.db
        .selectFrom('directories')
        .select(['spaceId'])
        .select((eb) => eb.fn.count('id').as('count'))
        .where('spaceId', 'in', spaceIds)
        .where('deletedAt', 'is', null)
        .groupBy('spaceId')
        .execute()
    : [];

  const hasDirectoriesMap = new Set(
    directoryCounts
      .filter((d) => Number(d.count) > 0)
      .map((d) => d.spaceId),
  );

  return {
    items: spaces.map((s) => ({
      ...s,
      hasDirectories: hasDirectoriesMap.has(s.id),
    })),
  };
}
```

**Step 2: 新增 getDirectories() 方法**

```typescript
async getDirectories(spaceSlug: string, workspaceId: string) {
  if (!this.isSpacePublic(spaceSlug)) {
    throw new NotFoundException('Space not found');
  }

  const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
  if (!space) {
    throw new NotFoundException('Space not found');
  }

  const directories = await this.db
    .selectFrom('directories')
    .select(['id', 'name', 'slug', 'icon', 'position'])
    .where('spaceId', '=', space.id)
    .where('deletedAt', 'is', null)
    .orderBy('position', 'asc')
    .execute();

  return { items: directories };
}
```

**Step 3: 修改 getSidebarTree() 支持 directoryId**

修改方法签名并增加 directoryId 分支逻辑：

```typescript
async getSidebarTree(spaceSlug: string, workspaceId: string, directoryId?: string) {
  if (!this.isSpacePublic(spaceSlug)) {
    throw new NotFoundException('Space not found');
  }

  const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
  if (!space) {
    throw new NotFoundException('Space not found');
  }

  // 有 directoryId 时：按目录过滤，返回带 topic 分组的混合树
  if (directoryId) {
    return this.buildDirectorySidebar(space, directoryId);
  }

  // 无 directoryId：保持现有行为
  const pages = await this.db
    .selectFrom('pages')
    .select([
      'id', 'slugId', 'title', 'icon', 'position', 'parentPageId', 'spaceId',
    ])
    .select((eb) => this.pageRepo.withHasChildren(eb))
    .where('spaceId', '=', space.id)
    .where('deletedAt', 'is', null)
    .orderBy('position', 'asc')
    .execute();

  const tree = this.buildTree(pages, null);
  return { space: { id: space.id, name: space.name, slug: space.slug }, items: tree };
}
```

**Step 4: 新增 buildDirectorySidebar() 私有方法**

```typescript
private async buildDirectorySidebar(
  space: { id: string; name: string; slug: string },
  directoryId: string,
) {
  // 验证目录存在
  const directory = await this.db
    .selectFrom('directories')
    .select(['id', 'name', 'icon'])
    .where('id', '=', directoryId)
    .where('spaceId', '=', space.id)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();

  if (!directory) {
    throw new NotFoundException('Directory not found');
  }

  // 查询该目录下的 topics
  const topics = await this.db
    .selectFrom('topics')
    .select(['id', 'name', 'icon', 'position'])
    .where('directoryId', '=', directoryId)
    .where('deletedAt', 'is', null)
    .orderBy('position', 'asc')
    .execute();

  // 查询该目录下的所有页面（包括有 topic 和无 topic 的）
  const pages = await this.db
    .selectFrom('pages')
    .select([
      'id', 'slugId', 'title', 'icon', 'position',
      'parentPageId', 'topicId', 'directoryId',
    ])
    .select((eb) => this.pageRepo.withHasChildren(eb))
    .where('directoryId', '=', directoryId)
    .where('deletedAt', 'is', null)
    .orderBy('position', 'asc')
    .execute();

  // 构建混合树：topics 和无 topic 的根页面按 position 排序
  const items: any[] = [];

  // 为每个 topic 收集其下的页面
  for (const topic of topics) {
    const topicPages = pages.filter((p) => p.topicId === topic.id && !p.parentPageId);
    items.push({
      nodeType: 'topic',
      id: topic.id,
      name: topic.name,
      icon: topic.icon,
      position: topic.position,
      children: topicPages.map((p) => ({
        nodeType: 'page',
        id: p.id,
        slugId: p.slugId,
        title: p.title,
        icon: p.icon,
        position: p.position,
        hasChildren: p.hasChildren,
        children: p.hasChildren ? this.buildTree(pages.filter((pp) => pp.topicId === topic.id), p.id) : [],
      })),
    });
  }

  // 无 topic 的根页面（directoryId 匹配但 topicId 为 null，且 parentPageId 为 null）
  const uncategorizedPages = pages.filter(
    (p) => !p.topicId && !p.parentPageId,
  );
  for (const p of uncategorizedPages) {
    items.push({
      nodeType: 'page',
      id: p.id,
      slugId: p.slugId,
      title: p.title,
      icon: p.icon,
      position: p.position,
      hasChildren: p.hasChildren,
      children: p.hasChildren ? this.buildTree(pages.filter((pp) => !pp.topicId), p.id) : [],
    });
  }

  // 按 position 排序保持后端顺序
  items.sort((a, b) => (a.position || '').localeCompare(b.position || ''));

  return {
    space: { id: space.id, name: space.name, slug: space.slug },
    directory: { id: directory.id, name: directory.name },
    items,
  };
}
```

**Step 5: 提交**

```bash
git add apps/server/src/core/public-wiki/public-wiki.service.ts
git commit -m "feat(public-wiki): add getDirectories, extend getSidebarTree with directoryId filter"
```

---

### Task 3: 后端 — 扩展 Controller

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.controller.ts`

**Step 1: 添加 directories 端点，修改 sidebar 端点传参**

在 controller 中导入 `PublicDirectoriesDto`，新增 directories 端点：

```typescript
// 导入新增
import {
  PublicSidebarDto,
  PublicPageDto,
  PublicSearchDto,
  PublicAiAnswerDto,
  PublicDirectoriesDto,  // 新增
} from './dto/public-wiki.dto';

// 新增端点
@Public()
@HttpCode(HttpStatus.OK)
@Post('directories')
async getDirectories(
  @Body() dto: PublicDirectoriesDto,
  @AuthWorkspace() workspace: Workspace,
) {
  return this.publicWikiService.getDirectories(dto.spaceSlug, workspace.id);
}

// 修改现有 sidebar 端点 —— 透传 directoryId
@Public()
@HttpCode(HttpStatus.OK)
@Post('sidebar')
async getSidebar(
  @Body() dto: PublicSidebarDto,
  @AuthWorkspace() workspace: Workspace,
) {
  return this.publicWikiService.getSidebarTree(dto.spaceSlug, workspace.id, dto.directoryId);
}
```

**Step 2: 提交**

```bash
git add apps/server/src/core/public-wiki/public-wiki.controller.ts
git commit -m "feat(public-wiki): add directories endpoint, pass directoryId to sidebar"
```

---

### Task 4: 前端 — 扩展类型定义

**Files:**
- Modify: `wiki/docs/.vitepress/theme/types/index.ts`

**Step 1: 新增 DocmostDirectory 接口，扩展现有类型**

```typescript
// 新增 —— 在 DocmostSpace 定义之后
/** Docmost 目录 */
export interface DocmostDirectory {
  id: string
  name: string
  slug: string
  icon?: string
  position: string
}

// 修改 DocmostSpace —— 增加 hasDirectories
export interface DocmostSpace {
  id: string
  name: string
  slug: string
  description?: string
  hasDirectories?: boolean  // 新增
}

// 修改 DocmostSidebarNode —— 增加 nodeType 和 name
export interface DocmostSidebarNode {
  nodeType?: 'topic' | 'page'  // 新增
  id: string
  name?: string                // 新增（topic 用）
  slugId?: string              // page 用（改为可选）
  title?: string               // page 用（改为可选）
  icon?: string
  position: string
  hasChildren?: boolean        // 改为可选（topic 无此字段）
  children: DocmostSidebarNode[]
}
```

**Step 2: 提交**

```bash
git add wiki/docs/.vitepress/theme/types/index.ts
git commit -m "feat(wiki): add DocmostDirectory type, extend DocmostSpace and DocmostSidebarNode"
```

---

### Task 5: 前端 — 扩展 API 服务

**Files:**
- Modify: `wiki/docs/.vitepress/theme/services/docmost.ts`

**Step 1: 新增 getDirectories 方法，修改 getSidebar 签名**

在 `DocmostService` 类中添加：

```typescript
/**
 * 获取空间下的目录列表
 */
async getDirectories(spaceSlug: string): Promise<DocmostDirectory[]> {
  const result = await this.post<{ items: DocmostDirectory[] }>('directories', { spaceSlug })
  return result.items
}
```

修改 `getSidebar`：

```typescript
/**
 * 获取空间侧边栏页面树
 * @param directoryId 可选，传入时返回该目录下的 topic+page 混合树
 */
async getSidebar(spaceSlug: string, directoryId?: string): Promise<{
  space: { id: string; name: string; slug: string }
  directory?: { id: string; name: string }
  items: DocmostSidebarNode[]
}> {
  const body: Record<string, string> = { spaceSlug }
  if (directoryId) body.directoryId = directoryId
  return this.post('sidebar', body)
}
```

在文件顶部导入中增加 `DocmostDirectory`：

```typescript
import type {
  DocmostSpace,
  DocmostSidebarNode,
  DocmostPage,
  DocmostSearchResult,
  DocmostAiStreamEvent,
  DocmostDirectory,       // 新增
} from '../types'
```

**Step 2: 提交**

```bash
git add wiki/docs/.vitepress/theme/services/docmost.ts
git commit -m "feat(wiki): add getDirectories API, extend getSidebar with directoryId param"
```

---

### Task 6: 前端 — 重构 useDocmostSidebar composable

**Files:**
- Modify: `wiki/docs/.vitepress/theme/composables/useDocmostSidebar.ts`

这是核心改动，需要增加目录状态管理和侧边栏映射逻辑。

**Step 1: 增加目录相关状态和导入**

```typescript
import type { DocmostSpace, DocmostSidebarNode, DocmostDirectory, SidebarItem } from '../types'

// 全局状态（模块级别共享）
const spaces = ref<DocmostSpace[]>([])
const sidebarData = ref<Record<string, DocmostSidebarNode[]>>({})
const directories = ref<Record<string, DocmostDirectory[]>>({})   // 新增：按 spaceSlug 存储目录
const selectedDirectoryId = ref<Record<string, string>>({})       // 新增：按 spaceSlug 存储选中目录 ID
const isLoading = ref(false)
const isLoaded = ref(false)
```

**Step 2: 修改 mapToSidebarItems 支持 topic 节点**

```typescript
function mapToSidebarItems(
  nodes: DocmostSidebarNode[],
  spaceSlug: string,
  lang: string
): SidebarItem[] {
  return nodes.map((node) => {
    // topic 节点 → 分组标题（无 link，只有 text + items）
    if (node.nodeType === 'topic') {
      const topicText = node.icon ? `${node.icon} ${node.name || '无标题'}` : (node.name || '无标题')
      return {
        text: topicText,
        items: node.children?.length
          ? mapToSidebarItems(node.children, spaceSlug, lang)
          : undefined,
        collapsed: false,
      }
    }

    // page 节点（默认）
    const item: SidebarItem = {
      text: node.icon ? `${node.icon} ${node.title || '无标题'}` : (node.title || '无标题'),
      link: `/${lang}/docs/${spaceSlug}/${node.slugId}`,
    }
    if (node.hasChildren && node.children && node.children.length > 0) {
      item.items = mapToSidebarItems(node.children, spaceSlug, lang)
      item.collapsed = false
    }
    return item
  })
}
```

**Step 3: 修改 loadSpaces 加载目录**

```typescript
async function loadSpaces() {
  const service = getService()
  if (!service || isLoaded.value || isLoading.value) return

  isLoading.value = true
  try {
    const loadedSpaces = await service.getSpaces()
    spaces.value = loadedSpaces

    // 并行加载: 有目录的空间加载目录列表，无目录的空间直接加载侧边栏
    const newSidebarData: Record<string, DocmostSidebarNode[]> = {}
    const newDirectories: Record<string, DocmostDirectory[]> = {}
    const newSelectedDir: Record<string, string> = {}

    await Promise.all(
      loadedSpaces.map(async (space) => {
        try {
          if (space.hasDirectories) {
            // 有目录：先加载目录列表
            const dirs = await service.getDirectories(space.slug)
            newDirectories[space.slug] = dirs
            if (dirs.length > 0) {
              // 自动选中第一个目录，并加载其侧边栏
              newSelectedDir[space.slug] = dirs[0].id
              const result = await service.getSidebar(space.slug, dirs[0].id)
              newSidebarData[space.slug] = result.items
            }
          } else {
            // 无目录：直接加载传统侧边栏
            const result = await service.getSidebar(space.slug)
            newSidebarData[space.slug] = result.items
          }
        } catch (err) {
          console.warn(`[Docmost] 加载空间 ${space.slug} 失败:`, err)
        }
      })
    )

    sidebarData.value = newSidebarData
    directories.value = newDirectories
    selectedDirectoryId.value = newSelectedDir
    isLoaded.value = true
  } catch (err) {
    console.error('[Docmost] 加载空间列表失败:', err)
  } finally {
    isLoading.value = false
  }
}
```

**Step 4: 新增 selectDirectory 方法**

```typescript
async function selectDirectory(spaceSlug: string, directoryId: string) {
  const service = getService()
  if (!service) return

  // 已选中则跳过
  if (selectedDirectoryId.value[spaceSlug] === directoryId) return

  selectedDirectoryId.value = { ...selectedDirectoryId.value, [spaceSlug]: directoryId }

  try {
    const result = await service.getSidebar(spaceSlug, directoryId)
    sidebarData.value = { ...sidebarData.value, [spaceSlug]: result.items }
  } catch (err) {
    console.warn(`[Docmost] 加载目录侧边栏失败:`, err)
  }
}
```

**Step 5: 修改 buildSidebarForRoute**

现有的 `buildSidebarForRoute` 基本保持不变（它已经读取 `sidebarData[spaceSlug]`），但 `mapToSidebarItems` 现在能处理 topic 节点了，所以不需要大改。确认分组渲染：

当侧边栏数据包含 topic 时，`mapToSidebarItems` 会生成 `{ text: 'CRM系统', items: [...], collapsed: false }` 这样的结构。`SideBar.vue` 的模板中已有分组标题渲染逻辑（`sidebar-group-title`），但这条路径要求 `group.collapsed === undefined`。而 topic 节点我们返回的 `collapsed: false`，这意味着它会走 SideBarItem 的可折叠分组路径（无 link 有 items），效果一样好。

**Step 6: 暴露新状态**

```typescript
return {
  sidebarData,
  spaces,
  directories,                                    // 新增
  selectedDirectoryId,                             // 新增
  isLoading: computed(() => isLoading.value),
  isLoaded: computed(() => isLoaded.value),
  isAvailable: computed(() => !!getService()),
  loadSpaces,
  selectDirectory,                                 // 新增
  buildSidebarForRoute,
  isDocmostRoute,
}
```

**Step 7: 提交**

```bash
git add wiki/docs/.vitepress/theme/composables/useDocmostSidebar.ts
git commit -m "feat(wiki): add directory state management and topic-aware sidebar mapping"
```

---

### Task 7: 前端 — 修改 NavBar 支持目录下拉

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/NavBar.vue`

**Step 1: 引入目录相关数据**

在 `<script setup>` 中：

```typescript
const {
  spaces: docmostSpaces,
  directories: docmostDirectories,   // 新增
  selectedDirectoryId,               // 新增
  selectDirectory,                   // 新增
} = useDocmostSidebar()
```

**Step 2: 修改 navItems 计算属性**

把有目录的空间转为下拉菜单（`items` 数组），无目录的保持普通链接：

```typescript
const navItems = computed(() => {
  const staticNav = theme.value.nav || []
  const coveredSlugs = extractStaticSlugs(staticNav)
  const lang = currentLang.value

  const dynamicItems = docmostSpaces.value
    .filter((space) => !coveredSlugs.has(space.slug))
    .map((space) => {
      const dirs = docmostDirectories.value[space.slug]

      if (space.hasDirectories && dirs && dirs.length > 0) {
        // 有目录 → 生成下拉菜单
        return {
          text: space.name,
          link: `/${lang}/docs/${space.slug}/`,
          activeMatch: `^/${lang}/docs/${space.slug}`,
          items: dirs.map((dir) => ({
            text: dir.icon ? `${dir.icon} ${dir.name}` : dir.name,
            directoryId: dir.id,
            spaceSlug: space.slug,
            link: `/${lang}/docs/${space.slug}/`,
          })),
        }
      }

      // 无目录 → 普通链接
      return {
        text: space.name,
        link: `/${lang}/docs/${space.slug}/`,
        activeMatch: `^/${lang}/docs/${space.slug}`,
      }
    })

  if (dynamicItems.length === 0) return staticNav
  return [...staticNav, ...dynamicItems]
})
```

**Step 3: 修改模板中的下拉菜单点击**

找到 `<a v-for="child in item.items"` 部分，修改下拉项的点击处理：

```html
<!-- 下拉菜单 -->
<div
  v-show="openDropdown === item.text"
  class="nav-dropdown-menu"
>
  <a
    v-for="child in item.items"
    :key="child.text"
    :href="child.link"
    class="nav-dropdown-item"
    :class="{
      'is-active': child.directoryId
        ? selectedDirectoryId[child.spaceSlug] === child.directoryId
        : isActive(child.link, child.activeMatch)
    }"
    @click="handleDirectoryClick($event, child)"
  >
    {{ child.text }}
  </a>
</div>
```

**Step 4: 新增 handleDirectoryClick 方法**

```typescript
const handleDirectoryClick = (event: Event, child: any) => {
  closeDropdown()
  if (child.directoryId && child.spaceSlug) {
    selectDirectory(child.spaceSlug, child.directoryId)
  }
}
```

**Step 5: 提交**

```bash
git add wiki/docs/.vitepress/theme/components/NavBar.vue
git commit -m "feat(wiki): NavBar directory dropdown for spaces with directories"
```

---

### Task 8: 集成验证

**Step 1: 启动后端开发服务器**

```bash
cd E:/test/Docmost && pnpm dev
```

**Step 2: 确认 API 正常**

用 curl 测试新端点：

```bash
# 测试 spaces 返回 hasDirectories
curl -s -X POST http://localhost:3000/api/public-wiki/spaces | jq '.data.items[0].hasDirectories'

# 测试 directories 端点
curl -s -X POST http://localhost:3000/api/public-wiki/directories \
  -H "Content-Type: application/json" \
  -d '{"spaceSlug":"your-space-slug"}' | jq '.data.items'

# 测试 sidebar 带 directoryId
curl -s -X POST http://localhost:3000/api/public-wiki/sidebar \
  -H "Content-Type: application/json" \
  -d '{"spaceSlug":"your-space-slug","directoryId":"your-directory-id"}' | jq '.data.items'
```

**Step 3: 启动 wiki 前端**

```bash
cd E:/test/Docmost/wiki && pnpm dev
```

**Step 4: 浏览器验证**

- 访问有目录的空间 → 顶部导航应显示下拉箭头
- 点击下拉箭头 → 应展示目录列表
- 点击目录 → 左侧侧边栏应更新为该目录下的主题+页面
- 访问无目录的空间 → 保持原有行为
- 点击空间名（有目录时）→ 自动加载第一个目录的内容

**Step 5: 最终提交**

确认一切正常后，如有遗漏的微调一并提交。
