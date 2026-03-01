<script setup lang="ts">
/**
 * Docmost 动态内容组件
 * 从 Docmost API 获取页面内容并根据设置以 HTML 或 Markdown 模式渲染
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vitepress'
import { createDocmostService } from '../services/docmost'
import { useDocmostSidebar } from '../composables/useDocmostSidebar'
import { rewriteAttachmentUrls, processSpecialBlocks } from '../composables/useContentProcessor'
import { useCodeCopy } from '../composables/useCodeCopy'
import { renderMarkdownToHtml } from '../utils/markdown'
import type { DocmostPage, DocmostSidebarNode } from '../types'

const route = useRoute()
const router = useRouter()
const docmostService = createDocmostService()
const { spaces, sidebarData } = useDocmostSidebar()

const page = ref<DocmostPage | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const renderFormat = ref<'html' | 'markdown'>('html')

// 代码块复制功能（事件委托监听 .code-copy-btn 点击）
useCodeCopy(contentRef)

// 模块级缓存：避免每个页面都请求 settings API
let cachedRenderFormat: 'html' | 'markdown' | null = null

async function loadRenderFormat() {
  if (cachedRenderFormat) {
    renderFormat.value = cachedRenderFormat
    return
  }
  try {
    const settings = await docmostService?.getSettings()
    if (settings?.wiki?.renderFormat) {
      cachedRenderFormat = settings.wiki.renderFormat
      renderFormat.value = cachedRenderFormat
    }
  } catch (err) {
    console.warn('[DocmostContent] 获取 Wiki 设置失败，使用默认 HTML 渲染:', err)
  }
}

/**
 * 根据 renderFormat 处理页面内容
 * - markdown 模式：Markdown → 附件 URL 绝对化 → 渲染为 HTML
 * - html 模式：HTML → 附件 URL 绝对化 → 直接输出
 */
const processedContent = computed(() => {
  if (!page.value?.content) return ''
  const contentWithUrls = rewriteAttachmentUrls(page.value.content)
  if (renderFormat.value === 'markdown') {
    return renderMarkdownToHtml(contentWithUrls)
  }
  return contentWithUrls
})

/**
 * 从路由中解析空间 slug 和页面 slugId
 */
const routeParams = computed(() => {
  // 去掉可能混入的 hash 片段（页面刷新时 route.path 可能包含 #anchor）
  const path = route.path.replace(/#.*$/, '')
  const match = path.match(/^\/(zh|en|vi)\/docs\/([^/]+)\/([^/]+)/)
  if (match) {
    return { lang: match[1], spaceSlug: match[2], slugId: match[3] }
  }
  // 可能是空间根路径 /{lang}/docs/{spaceSlug}/
  const spaceMatch = path.match(/^\/(zh|en|vi)\/docs\/([^/]+)\/?$/)
  if (spaceMatch) {
    return { lang: spaceMatch[1], spaceSlug: spaceMatch[2], slugId: null }
  }
  return null
})

/**
 * 当前空间是否存在于 Docmost 中
 */
const spaceExists = computed(() => {
  if (!routeParams.value) return false
  return spaces.value.some((s) => s.slug === routeParams.value!.spaceSlug)
})

/**
 * 空间显示名称（优先使用 Docmost 空间名，回退到 slug）
 */
const spaceDisplayName = computed(() => {
  if (!routeParams.value) return ''
  const space = spaces.value.find((s) => s.slug === routeParams.value!.spaceSlug)
  return space?.name || routeParams.value.spaceSlug
})

/**
 * 多语言标签
 */
const i18nLabels = computed(() => {
  const lang = routeParams.value?.lang || 'zh'
  const labels: Record<string, { prev: string; next: string; lastUpdated: string; author: string; editPage: string }> = {
    zh: { prev: '上一页', next: '下一页', lastUpdated: '最后更新', author: '作者', editPage: '编辑此页' },
    en: { prev: 'Previous', next: 'Next', lastUpdated: 'Last updated', author: 'Author', editPage: 'Edit this page' },
    vi: { prev: 'Trước', next: 'Tiếp', lastUpdated: 'Cập nhật lần cuối', author: 'Tác giả', editPage: 'Chỉnh sửa trang' },
  }
  return labels[lang] || labels.zh
})

/**
 * 格式化日期时间（精确到秒）
 */
function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Docmost 编辑页面链接
 */
const editPageUrl = computed(() => {
  if (!page.value) return null
  const apiUrl = import.meta.env.VITE_DOCMOST_API_URL as string | undefined
  if (!apiUrl) return null
  try {
    const origin = new URL(apiUrl).origin
    return `${origin}/s/${page.value.spaceSlug}/p/${page.value.slugId}`
  } catch {
    return null
  }
})


/**
 * 在侧边栏树中找到第一个页面的 slugId
 * topic 节点没有 slugId，需要递归进入 children
 */
function findFirstPageSlugId(nodes: DocmostSidebarNode[]): string | null {
  for (const node of nodes) {
    if (node.nodeType === 'topic') {
      if (node.children?.length) {
        const found = findFirstPageSlugId(node.children)
        if (found) return found
      }
      continue
    }
    if (node.slugId) return node.slugId
    if (node.children?.length) {
      const found = findFirstPageSlugId(node.children)
      if (found) return found
    }
  }
  return null
}

/**
 * 自动跳转到侧边栏第一篇文章
 * - 进入空间根路径（无 slugId）时跳转
 * - 切换目录后当前页面不在新侧边栏中时跳转
 */
function tryNavigateToFirstPage() {
  if (!routeParams.value) return
  const { lang, spaceSlug, slugId } = routeParams.value
  const nodes = sidebarData.value[spaceSlug]
  if (!nodes?.length) return

  if (!slugId) {
    const firstSlugId = findFirstPageSlugId(nodes)
    if (firstSlugId) {
      router.go(`/${lang}/docs/${spaceSlug}/${firstSlugId}`)
    }
    return
  }

  // 当前页面是否在侧边栏中（切换目录后可能不在）
  const flat = flattenTree(nodes)
  if (!flat.some((p) => p.slugId === slugId)) {
    const firstSlugId = findFirstPageSlugId(nodes)
    if (firstSlugId) {
      router.go(`/${lang}/docs/${spaceSlug}/${firstSlugId}`)
    }
  }
}

/**
 * 在侧边栏树中查找指定 slugId 页面的子页面
 */
function findChildrenInSidebar(slugId: string, nodes: DocmostSidebarNode[]): DocmostSidebarNode[] {
  for (const node of nodes) {
    if (node.slugId === slugId) {
      return (node.children || []).filter((c) => c.slugId)
    }
    if (node.children?.length) {
      const found = findChildrenInSidebar(slugId, node.children)
      if (found.length) return found
    }
  }
  return []
}

/**
 * 处理内容中的 subpages 占位符，替换为子页面卡片网格
 */
function processSubpagesBlocks(container: HTMLElement) {
  const els = container.querySelectorAll('div[data-type="subpages"]')
  if (els.length === 0 || !routeParams.value?.slugId) return

  const { spaceSlug, slugId, lang } = routeParams.value
  const nodes = sidebarData.value[spaceSlug]
  if (!nodes?.length) return

  const children = findChildrenInSidebar(slugId!, nodes)

  els.forEach((el) => {
    if (children.length === 0) {
      el.remove()
      return
    }
    const grid = document.createElement('div')
    grid.className = 'docmost-subpages-grid'
    children.forEach((child) => {
      const card = document.createElement('a')
      card.href = `/${lang}/docs/${spaceSlug}/${child.slugId}`
      card.className = 'subpage-card'

      // 图标徽章
      const badge = document.createElement('span')
      badge.className = 'subpage-card-icon'
      if (child.icon) {
        badge.textContent = child.icon
      } else {
        badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
      }
      card.appendChild(badge)

      // 标题
      const title = document.createElement('div')
      title.className = 'subpage-card-title'
      title.textContent = child.title || '无标题'
      card.appendChild(title)

      // 摘要
      if (child.excerpt) {
        const desc = document.createElement('div')
        desc.className = 'subpage-card-desc'
        desc.textContent = child.excerpt
        card.appendChild(desc)
      }

      grid.appendChild(card)
    })
    el.replaceWith(grid)
  })
}

/**
 * 将侧边栏树展平为有序列表（用于上/下页导航）
 */
function flattenTree(nodes: DocmostSidebarNode[]): { slugId: string; title: string; icon?: string }[] {
  const result: { slugId: string; title: string; icon?: string }[] = []
  for (const node of nodes) {
    // 只收集页面节点（topic 节点没有 slugId，跳过）
    if (node.slugId) {
      result.push({ slugId: node.slugId, title: node.title, icon: node.icon })
    }
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children))
    }
  }
  return result
}

/**
 * 上一页 / 下一页
 */
const prevNext = computed(() => {
  if (!routeParams.value?.spaceSlug || !routeParams.value?.slugId) return { prev: null, next: null }
  const spaceSlug = routeParams.value.spaceSlug
  const nodes = sidebarData.value[spaceSlug]
  if (!nodes || nodes.length === 0) return { prev: null, next: null }

  const flat = flattenTree(nodes)
  const currentIdx = flat.findIndex((p) => p.slugId === routeParams.value!.slugId)
  if (currentIdx === -1) return { prev: null, next: null }

  const lang = routeParams.value.lang || 'zh'
  const prevItem = currentIdx > 0 ? flat[currentIdx - 1] : null
  const nextItem = currentIdx < flat.length - 1 ? flat[currentIdx + 1] : null

  return {
    prev: prevItem ? { ...prevItem, link: `/${lang}/docs/${spaceSlug}/${prevItem.slugId}` } : null,
    next: nextItem ? { ...nextItem, link: `/${lang}/docs/${spaceSlug}/${nextItem.slugId}` } : null,
  }
})

/**
 * 加载页面内容
 */
async function loadPage() {
  if (!docmostService || !routeParams.value) return

  // 首次加载时获取渲染格式设置
  await loadRenderFormat()

  const { slugId, spaceSlug, lang } = routeParams.value
  if (!slugId) {
    // 空间根路径：尝试跳转到第一篇文章
    page.value = null
    error.value = null

    const nodes = sidebarData.value[spaceSlug]
    if (nodes?.length) {
      const firstSlugId = findFirstPageSlugId(nodes)
      if (firstSlugId) {
        router.go(`/${lang}/docs/${spaceSlug}/${firstSlugId}`)
        return
      }
    }

    // 侧边栏数据尚未加载，显示占位（watch 会在数据到达后触发跳转）
    const space = spaces.value.find((s) => s.slug === routeParams.value!.spaceSlug)
    const displayName = space?.name || routeParams.value!.spaceSlug
    if (typeof document !== 'undefined') {
      document.title = `${displayName} | FORCOME 知识库`
    }
    return
  }

  isLoading.value = true
  error.value = null

  try {
    const result = await docmostService.getPage(slugId, renderFormat.value)
    page.value = result

    // 更新页面标题（修复 404 标签显示）
    if (typeof document !== 'undefined') {
      document.title = `${result.title || '文档'} | FORCOME 知识库`
    }

    // 先关闭加载状态，让 v-else-if="page" 块渲染到 DOM
    isLoading.value = false

    // 等待 DOM 更新后进行阶段2处理并触发 TOC 重建
    await nextTick()
    // 捕获容器引用一次，避免 await processSpecialBlocks 期间
    // 目录切换导致 contentRef.value 变为 null 的竞态条件
    const container = contentRef.value
    if (container) {
      await processSpecialBlocks(container)
      processSubpagesBlocks(container)
    }
    window.dispatchEvent(new Event('docmost-content-loaded'))
  } catch (err: any) {
    console.error('[DocmostContent] 加载页面失败:', err)
    error.value = err?.message || '加载页面失败'
    page.value = null
    isLoading.value = false
  }
}

// 监听路由变化重新加载（去掉 hash 避免锚点变化触发重载）
watch(() => route.path.replace(/#.*$/, ''), () => {
  loadPage()
}, { immediate: true })

// 侧边栏数据变化时自动跳转（处理延迟加载 + 目录切换）
watch(sidebarData, () => {
  tryNavigateToFirstPage()
}, { deep: false })

// 监听主题变化，重新渲染 Mermaid 图表
let themeObserver: MutationObserver | null = null

onMounted(() => {
  loadPage()

  themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class' && contentRef.value) {
        processSpecialBlocks(contentRef.value)
        break
      }
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onUnmounted(() => {
  themeObserver?.disconnect()
})
</script>

<template>
  <div class="docmost-content">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="docmost-loading">
      <div class="loading-spinner" />
      <span>加载中...</span>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="docmost-error">
      <h1>页面加载失败</h1>
      <p>{{ error }}</p>
      <button @click="loadPage" class="retry-btn">重新加载</button>
    </div>

    <!-- 空间根路径（无页面） -->
    <div v-else-if="!page && routeParams && !routeParams.slugId" class="docmost-space-root">
      <h1>{{ spaceDisplayName }}</h1>
      <p v-if="spaceExists">请从左侧导航栏选择一个页面。</p>
      <p v-else class="space-not-found">该空间尚未创建内容，请稍后再来。</p>
    </div>

    <!-- 页面内容 -->
    <div v-else-if="page" class="docmost-page">
      <!-- 面包屑 -->
      <nav v-if="page.breadcrumbs && page.breadcrumbs.length > 0" class="docmost-breadcrumbs">
        <template v-for="(crumb, index) in page.breadcrumbs" :key="crumb.id">
          <a
            :href="`/${routeParams?.lang || 'zh'}/docs/${page.spaceSlug}/${crumb.slugId}`"
            class="breadcrumb-link"
          >{{ crumb.title || '无标题' }}</a>
          <span v-if="index < page.breadcrumbs.length - 1" class="breadcrumb-sep">/</span>
        </template>
      </nav>

      <!-- 页面标题 -->
      <h1>{{ page.icon ? `${page.icon} ` : '' }}{{ page.title }}</h1>

      <!-- HTML 内容 -->
      <div ref="contentRef" class="docmost-html-content" v-html="processedContent" />

      <!-- 页面元信息 -->
      <footer v-if="page.updatedAt || page.creator" class="docmost-footer">
        <div class="footer-info">
          <div class="footer-info-left">
            <span v-if="page.creator" class="info-author">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {{ i18nLabels.author }}: {{ page.creator.name }}
            </span>
            <span v-if="page.updatedAt" class="info-updated">
              {{ i18nLabels.lastUpdated }}: {{ formatDateTime(page.updatedAt) }}
            </span>
          </div>
          <div class="footer-info-right">
            <a v-if="editPageUrl" :href="editPageUrl" target="_blank" rel="noopener noreferrer" class="edit-link">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {{ i18nLabels.editPage }}
            </a>
          </div>
        </div>
      </footer>

      <!-- 上一页 / 下一页 -->
      <nav v-if="prevNext.prev || prevNext.next" class="docmost-prev-next">
        <div class="pager">
          <a v-if="prevNext.prev" :href="prevNext.prev.link" class="pager-link prev">
            <span class="desc">{{ i18nLabels.prev }}</span>
            <span class="title">{{ prevNext.prev.icon ? `${prevNext.prev.icon} ` : '' }}{{ prevNext.prev.title }}</span>
          </a>
        </div>
        <div class="pager">
          <a v-if="prevNext.next" :href="prevNext.next.link" class="pager-link next">
            <span class="desc">{{ i18nLabels.next }}</span>
            <span class="title">{{ prevNext.next.icon ? `${prevNext.next.icon} ` : '' }}{{ prevNext.next.title }}</span>
          </a>
        </div>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.docmost-content {
  min-height: 200px;
}

/* 全局取消 footer 区域所有链接的下划线 */
.docmost-page a {
  text-decoration: none;
}

.docmost-page a:hover {
  text-decoration: none;
}

/* 加载状态 */
.docmost-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--c-text-3);
  gap: 12px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 错误状态 */
.docmost-error {
  text-align: center;
  padding: 60px 20px;
}

.docmost-error h1 {
  font-size: 24px;
  margin-bottom: 12px;
}

.docmost-error p {
  color: var(--c-text-3);
  margin-bottom: 20px;
}

.retry-btn {
  padding: 8px 20px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-1);
  cursor: pointer;
  font-size: 14px;
}

.retry-btn:hover {
  background: var(--c-hover);
}

/* 空间根路径 */
.docmost-space-root {
  padding: 40px 0;
}

/* 面包屑 */
.docmost-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  font-size: 14px;
}

.breadcrumb-link {
  color: var(--c-text-3);
  text-decoration: none;
}

.breadcrumb-link:hover {
  color: var(--c-accent);
  text-decoration: none;
}

.breadcrumb-sep {
  color: var(--c-text-3);
}

/* 页面底部信息 */
.docmost-footer {
  margin-top: 40px;
  font-size: 13px;
  color: var(--c-text-3);
}

/* 信息行 */
.footer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--c-border);
  border-bottom: 1px solid var(--c-border);
}

@media (max-width: 640px) {
  .footer-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}

.footer-info-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.footer-info-right {
  display: flex;
  align-items: center;
}

.info-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  color: var(--c-text-2);
}

.edit-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--c-text-3);
  transition: color var(--transition-normal);
}

.edit-link:hover {
  color: var(--c-accent);
}

/* 上一页 / 下一页导航 */
.docmost-prev-next {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 24px;
}

@media (max-width: 640px) {
  .docmost-prev-next {
    grid-template-columns: 1fr;
  }
}

.pager {
  display: flex;
}

.pager:last-child {
  justify-content: flex-end;
}

.pager-link {
  display: block;
  width: 100%;
  padding: 11px 16px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  text-decoration: none;
  transition: border-color var(--transition-normal);
}

.pager-link:hover {
  border-color: var(--c-accent);
  text-decoration: none;
}

.pager-link.next {
  text-align: right;
}

.pager-link .desc {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-3);
  line-height: 20px;
}

.pager-link .title {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-accent);
  line-height: 20px;
  transition: color var(--transition-normal);
}
</style>

<style>
/* 全局样式：Docmost 渲染后的内容样式 */
.docmost-html-content {
}

/* ===== 代码块（Markdown 模式 + HTML 模式统一结构） ===== */
.docmost-html-content .code-block-wrapper {
  margin: 1em 0;
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--vp-code-block-bg, var(--c-bg-soft));
  border: 1px solid var(--c-border);
}

.docmost-html-content .code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background-color: var(--vp-code-block-bg, var(--c-bg-soft));
  border-bottom: 1px solid var(--c-border);
}

.docmost-html-content .code-lang-label {
  font-family: var(--vp-font-family-mono, monospace);
  font-size: 12px;
  color: var(--c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.docmost-html-content .code-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}

.docmost-html-content .code-copy-btn:hover {
  color: var(--c-text-1);
  background-color: var(--c-hover, rgba(0, 0, 0, 0.05));
}

.docmost-html-content .code-block-body {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.6;
  background: transparent;
  border: none;
  border-radius: 0;
}

.docmost-html-content .code-block-body code {
  font-size: inherit;
  background: none;
  padding: 0;
  border: none;
  color: var(--c-text-1);
}

/* 折叠块（turndown 输出 <details>/<summary> HTML 标签） */
.docmost-html-content details {
  border: 1px solid var(--c-border);
  border-radius: 6px;
  padding: 12px;
  margin: 16px 0;
}

.docmost-html-content details summary {
  cursor: pointer;
  font-weight: 500;
}

/* 任务列表微调（markdown-it-task-lists 插件输出） */
.docmost-html-content .task-list-item {
  list-style: none;
}

.docmost-html-content .task-list-item + .task-list-item {
  margin-top: 2px;
}

.docmost-html-content .task-list-item input[type="checkbox"] {
  margin-right: 0.4em;
  cursor: default;
}

/* Mermaid 渲染后容器 */
.docmost-html-content .docmost-mermaid-rendered {
  margin: 16px 0;
  text-align: center;
}

.docmost-html-content .docmost-mermaid-rendered svg {
  max-width: 100%;
  height: auto;
}

/* Mermaid 渲染失败降级样式 */
.docmost-mermaid-error-hint {
  padding: 8px 12px;
  color: var(--vp-c-warning-1, #e2a727);
  font-size: 13px;
  border: 1px dashed var(--vp-c-warning-2, #e2a72766);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: var(--vp-c-warning-soft, #e2a72711);
}

.docmost-html-content pre.docmost-mermaid-error {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  margin-top: 0;
  opacity: 0.7;
  font-size: 12px;
  max-height: 200px;
  overflow: auto;
}

/* KaTeX 公式 */
.docmost-html-content [data-type="mathBlock"] {
  margin: 16px 0;
  text-align: center;
  overflow-x: auto;
}

.docmost-html-content [data-type="mathInline"] {
  display: inline;
}

/* Embed 嵌入内容 */
.docmost-html-content [data-type="embed"] {
  margin: 16px 0;
  display: flex;
  justify-content: center;
}

.docmost-html-content [data-type="embed"] iframe {
  border-radius: 6px;
  max-width: 100%;
}

/* ===== HTML 模式：表格单元格内 <p> 去 margin ===== */
.docmost-html-content th p,
.docmost-html-content td p {
  margin: 0;
}

/* ===== HTML 模式：TipTap 任务列表 ===== */
.docmost-html-content ul[data-type="taskList"] {
  list-style: none;
  padding: 0;
}

.docmost-html-content ul[data-type="taskList"] p {
  margin: 0;
}

.docmost-html-content ul[data-type="taskList"] li {
  display: flex;
}

.docmost-html-content ul[data-type="taskList"] li > label {
  padding-top: 0.2rem;
  flex: 0 0 auto;
  margin-right: 0.5rem;
  user-select: none;
}

.docmost-html-content ul[data-type="taskList"] li > div {
  flex: 1 1 auto;
}

.docmost-html-content ul[data-type="taskList"] li > label input[type="checkbox"] {
  width: 1em;
  height: 1em;
  cursor: default;
}

/* 嵌套列表在 taskList 内恢复正常 */
.docmost-html-content ul[data-type="taskList"] li ul li,
.docmost-html-content ul[data-type="taskList"] li ol li {
  display: list-item;
}

.docmost-html-content ul[data-type="taskList"] li ul[data-type="taskList"] > li {
  display: flex;
}

/* ===== HTML 模式：TipTap Callout ===== */
.docmost-html-content div[data-type="callout"] {
  margin: 1em 0;
  padding: 1em;
  border-radius: 6px;
  border-left: 4px solid;
  background-color: rgba(0, 102, 255, 0.1);
  border-color: var(--c-accent, #2563eb);
}

.docmost-html-content div[data-type="callout"][data-callout-type="info"] {
  background-color: rgba(0, 102, 255, 0.1);
  border-color: var(--c-accent, #2563eb);
}

.docmost-html-content div[data-type="callout"][data-callout-type="tip"],
.docmost-html-content div[data-type="callout"][data-callout-type="success"] {
  background-color: rgba(16, 185, 129, 0.1);
  border-color: #10b981;
}

.docmost-html-content div[data-type="callout"][data-callout-type="warning"] {
  background-color: rgba(245, 158, 11, 0.1);
  border-color: #f59e0b;
}

.docmost-html-content div[data-type="callout"][data-callout-type="danger"],
.docmost-html-content div[data-type="callout"][data-callout-type="error"] {
  background-color: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

.docmost-html-content div[data-type="callout"] > p:first-child {
  margin-top: 0;
}

.docmost-html-content div[data-type="callout"] > p:last-child {
  margin-bottom: 0;
}

/* ===== Subpages 子页面卡片网格 ===== */
.docmost-subpages-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin: 24px 0;
}

@media (max-width: 640px) {
  .docmost-subpages-grid {
    grid-template-columns: 1fr;
  }
}

.docmost-subpages-grid .subpage-card {
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  border: 1px solid var(--c-border);
  border-radius: 12px;
  background-color: var(--c-bg-soft, #f5f5f2);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
}

:root.dark .docmost-subpages-grid .subpage-card {
  background-color: var(--c-bg-soft, #1e1e1e);
}

.docmost-subpages-grid .subpage-card:hover {
  border-color: var(--c-accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  text-decoration: none;
}

.docmost-subpages-grid .subpage-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 10px;
  border-radius: 10px;
  background-color: var(--c-bg, #fff);
  border: 1px solid var(--c-border);
  font-size: 20px;
  color: var(--c-text-3);
  flex-shrink: 0;
}

:root.dark .docmost-subpages-grid .subpage-card-icon {
  background-color: var(--c-bg, #242424);
}

.docmost-subpages-grid .subpage-card-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--c-text-1);
  line-height: 1.4;
  margin-bottom: 4px;
}

.docmost-subpages-grid .subpage-card-desc {
  font-size: 15px;
  color: var(--c-text-3);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
