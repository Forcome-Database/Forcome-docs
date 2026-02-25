<script setup lang="ts">
/**
 * Docmost 动态内容组件
 * 从 Docmost API 获取页面 HTML 并渲染
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import { createDocmostService } from '../services/docmost'
import { useDocmostSidebar } from '../composables/useDocmostSidebar'
import { rewriteAttachmentUrls, processSpecialBlocks } from '../composables/useContentProcessor'
import type { DocmostPage, DocmostSidebarNode } from '../types'

const route = useRoute()
const docmostService = createDocmostService()
const { spaces, sidebarData } = useDocmostSidebar()

const page = ref<DocmostPage | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
const contentRef = ref<HTMLElement | null>(null)

/**
 * 阶段1：附件 URL 绝对化后的 HTML 内容
 */
const processedContent = computed(() => {
  if (!page.value?.content) return ''
  return rewriteAttachmentUrls(page.value.content)
})

/**
 * 从路由中解析空间 slug 和页面 slugId
 */
const routeParams = computed(() => {
  const match = route.path.match(/^\/(zh|en|vi)\/docs\/([^/]+)\/([^/]+)/)
  if (match) {
    return { lang: match[1], spaceSlug: match[2], slugId: match[3] }
  }
  // 可能是空间根路径 /{lang}/docs/{spaceSlug}/
  const spaceMatch = route.path.match(/^\/(zh|en|vi)\/docs\/([^/]+)\/?$/)
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
 * 将侧边栏树展平为有序列表（用于上/下页导航）
 */
function flattenTree(nodes: DocmostSidebarNode[]): { slugId: string; title: string; icon?: string }[] {
  const result: { slugId: string; title: string; icon?: string }[] = []
  for (const node of nodes) {
    result.push({ slugId: node.slugId, title: node.title, icon: node.icon })
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

  const { slugId } = routeParams.value
  if (!slugId) {
    // 空间根路径，不显示页面内容
    page.value = null
    error.value = null
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
    const result = await docmostService.getPage(slugId)
    page.value = result

    // 更新页面标题（修复 404 标签显示）
    if (typeof document !== 'undefined') {
      document.title = `${result.title || '文档'} | FORCOME 知识库`
    }

    // 先关闭加载状态，让 v-else-if="page" 块渲染到 DOM
    isLoading.value = false

    // 等待 DOM 更新后进行阶段2处理并触发 TOC 重建
    await nextTick()
    if (contentRef.value) {
      await processSpecialBlocks(contentRef.value)
    }
    window.dispatchEvent(new Event('docmost-content-loaded'))
  } catch (err: any) {
    console.error('[DocmostContent] 加载页面失败:', err)
    error.value = err?.message || '加载页面失败'
    page.value = null
    isLoading.value = false
  }
}

// 监听路由变化重新加载
watch(() => route.path, () => {
  loadPage()
}, { immediate: true })

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
/* 全局样式：Docmost TipTap HTML 内容的样式（继承 .vp-doc 行高） */
.docmost-html-content {
}

/*
 * TipTap 会在 td/th/li 内部包裹 <p> 标签，而 VitePress markdown 不会。
 * .vp-doc p 有 margin: 16px 0，导致表格行高和列表间距被撑大。
 * 以下规则消除嵌套 <p> 的多余间距，对齐原版 .md 效果。
 */
.docmost-html-content td p,
.docmost-html-content th p {
  margin: 0;
  line-height: inherit;
}

.docmost-html-content li > p {
  margin: 0;
}

/* Callout 标注框 */
.docmost-html-content [data-callout] {
  padding: 12px 16px;
  border-radius: 6px;
  margin: 16px 0;
  border-left: 4px solid;
}

.docmost-html-content [data-callout="info"] {
  background-color: rgba(59, 130, 246, 0.08);
  border-left-color: rgb(59, 130, 246);
}

.docmost-html-content [data-callout="warning"] {
  background-color: rgba(245, 158, 11, 0.08);
  border-left-color: rgb(245, 158, 11);
}

.docmost-html-content [data-callout="danger"],
.docmost-html-content [data-callout="error"] {
  background-color: rgba(239, 68, 68, 0.08);
  border-left-color: rgb(239, 68, 68);
}

.docmost-html-content [data-callout="success"],
.docmost-html-content [data-callout="tip"] {
  background-color: rgba(34, 197, 94, 0.08);
  border-left-color: rgb(34, 197, 94);
}

/* 任务列表 */
.docmost-html-content ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
}

.docmost-html-content ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.docmost-html-content ul[data-type="taskList"] li input[type="checkbox"] {
  margin-top: 5px;
}

/* 折叠块（Docmost 特有） */
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

/* 表格、代码块、引用块、分隔线、图片等通用元素样式
   由 .vp-doc (vp-doc.css) 提供，此处不重复定义 */

/* Mermaid 渲染后容器 */
.docmost-html-content .docmost-mermaid-rendered {
  margin: 16px 0;
  text-align: center;
}

.docmost-html-content .docmost-mermaid-rendered svg {
  max-width: 100%;
  height: auto;
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
</style>
