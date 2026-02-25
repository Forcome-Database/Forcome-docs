/**
 * Docmost 动态侧边栏 composable
 * 从 Docmost API 获取空间和页面树，映射为 VitePress SidebarItem 格式
 */

import { ref, computed } from 'vue'
import { DocmostService, createDocmostService } from '../services/docmost'
import type { DocmostSpace, DocmostSidebarNode, SidebarItem } from '../types'

// 全局状态（模块级别共享，避免重复加载）
const spaces = ref<DocmostSpace[]>([])
const sidebarData = ref<Record<string, DocmostSidebarNode[]>>({})
const isLoading = ref(false)
const isLoaded = ref(false)

// 延迟初始化服务（避免 SSR 时 window 不存在）
let _service: DocmostService | null | undefined = undefined
function getService(): DocmostService | null {
  if (_service === undefined) {
    _service = createDocmostService()
  }
  return _service
}

function mapToSidebarItems(
  nodes: DocmostSidebarNode[],
  spaceSlug: string,
  lang: string
): SidebarItem[] {
  return nodes.map((node) => {
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

function getLangFromPath(path: string): string {
  const match = path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
}

function getSpaceSlugFromPath(path: string): string | null {
  const match = path.match(/^\/(zh|en|vi)\/docs\/([^/]+)/)
  return match ? match[2] : null
}

// 把侧边栏结果做成 computed，让 Vue 自动追踪 sidebarData 和 spaces 的变化
function buildSidebarForRoute(path: string): SidebarItem[] {
  const data = sidebarData.value
  const spaceList = spaces.value
  const lang = getLangFromPath(path)
  const spaceSlug = getSpaceSlugFromPath(path)

  if (spaceSlug) {
    // 有明确的空间 slug —— 只显示该空间
    if (data[spaceSlug]) {
      const space = spaceList.find((s) => s.slug === spaceSlug)
      return [{
        text: space?.name || spaceSlug,
        items: mapToSidebarItems(data[spaceSlug], spaceSlug, lang),
      }]
    }
    // slug 在 Docmost 中不存在，返回空数组（不再回退显示所有空间）
    return []
  }

  // 无 spaceSlug（/zh/docs/ 根路径）—— 显示所有空间
  const groups: SidebarItem[] = []
  for (const space of spaceList) {
    const pages = data[space.slug]
    if (pages && pages.length > 0) {
      groups.push({
        text: space.name,
        items: mapToSidebarItems(pages, space.slug, lang),
      })
    }
  }
  return groups
}

export function useDocmostSidebar() {
  async function loadSpaces() {
    const service = getService()
    if (!service || isLoaded.value || isLoading.value) return

    isLoading.value = true
    try {
      const loadedSpaces = await service.getSpaces()
      spaces.value = loadedSpaces

      const newData: Record<string, DocmostSidebarNode[]> = {}
      await Promise.all(
        loadedSpaces.map(async (space) => {
          try {
            const result = await service.getSidebar(space.slug)
            newData[space.slug] = result.items
          } catch (err) {
            console.warn(`[Docmost] 加载空间 ${space.slug} 侧边栏失败:`, err)
          }
        })
      )
      sidebarData.value = newData
      isLoaded.value = true
    } catch (err) {
      console.error('[Docmost] 加载空间列表失败:', err)
    } finally {
      isLoading.value = false
    }
  }

  function isDocmostRoute(path: string): boolean {
    return /^\/(zh|en|vi)\/docs\//.test(path)
  }

  return {
    // 直接暴露响应式数据，让消费者在自己的 computed 中读取
    sidebarData,
    spaces,
    isLoading: computed(() => isLoading.value),
    isLoaded: computed(() => isLoaded.value),
    isAvailable: computed(() => !!getService()),
    loadSpaces,
    buildSidebarForRoute,
    isDocmostRoute,
  }
}
