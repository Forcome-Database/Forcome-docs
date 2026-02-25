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
import type { DocmostPage } from '../types'

const route = useRoute()
const docmostService = createDocmostService()
const { spaces } = useDocmostSidebar()

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
      <div v-if="page.updatedAt" class="docmost-meta">
        <span>最后更新: {{ new Date(page.updatedAt).toLocaleDateString('zh-CN') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docmost-content {
  min-height: 200px;
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
}

.breadcrumb-sep {
  color: var(--c-text-3);
}

/* 页面元信息 */
.docmost-meta {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid var(--c-border);
  font-size: 13px;
  color: var(--c-text-3);
}
</style>

<style>
/* 全局样式：Docmost TipTap HTML 内容的样式 */
.docmost-html-content {
  line-height: 1.7;
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

/* 折叠块 */
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

/* 表格 */
.docmost-html-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.docmost-html-content th,
.docmost-html-content td {
  border: 1px solid var(--c-border);
  padding: 8px 12px;
  text-align: left;
}

.docmost-html-content th {
  background-color: var(--c-bg-soft);
  font-weight: 600;
}

/* 图片 */
.docmost-html-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

/* 代码块 */
.docmost-html-content pre {
  background-color: var(--c-bg-soft);
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  margin: 16px 0;
}

.docmost-html-content pre code {
  font-size: 14px;
  line-height: 1.5;
}

/* 行内代码 */
.docmost-html-content code:not(pre code) {
  background-color: var(--c-bg-soft);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}

/* 引用块 */
.docmost-html-content blockquote {
  border-left: 3px solid var(--c-border);
  padding-left: 16px;
  margin: 16px 0;
  color: var(--c-text-2);
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
