<script setup lang="ts">
/**
 * 右侧面板组件
 * 仿 Cursor 官网右侧区域：AI 入口 + 目录 + 工具栏
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import { useData } from 'vitepress'

// 获取页面数据
const { page } = useData()

// 注入 layout 提供的方法
const layout = inject<{ toggleAIChat: () => void }>('layout')

// 目录项接口
interface OutlineItem {
  id: string
  text: string
  level: number
}

// 目录数据
const outline = ref<OutlineItem[]>([])
// 当前激活的锚点
const activeId = ref('')
// 点击滚动锁定标志，防止 scroll spy 覆盖用户点击
let isClickScrolling = false
let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null
// 面板 DOM 引用
const panelRef = ref<HTMLElement | null>(null)
// 复制成功提示
const copySuccess = ref(false)

// 当前页面 URL
const pageUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return window.location.href
})

/**
 * 打开 AI 对话
 */
const openAIChat = () => {
  layout?.toggleAIChat()
}

/**
 * 从页面提取标题生成目录
 */
const buildOutline = () => {
  if (typeof document === 'undefined') return

  const headers = document.querySelectorAll('.content-wrapper h2, .content-wrapper h3')
  const items: OutlineItem[] = []

  headers.forEach((header) => {
    const id = header.id
    const text = header.textContent?.replace(/^#\s*/, '').replace(/\s*​$/, '') || ''
    const level = parseInt(header.tagName[1])

    if (id && text) {
      items.push({ id, text, level })
    }
  })

  outline.value = items
}

/**
 * 滚动监听，更新激活状态
 * 点击滚动期间跳过，防止 scroll spy 覆盖用户选择
 */
const updateActiveId = () => {
  if (typeof window === 'undefined' || isClickScrolling) return

  const headers = outline.value.map(item => document.getElementById(item.id)).filter(Boolean)

  let currentId = ''
  const offset = 100

  for (const header of headers) {
    if (header) {
      const rect = header.getBoundingClientRect()
      if (rect.top <= offset) {
        currentId = header.id
      }
    }
  }

  // 处理底部标题无法滚到 offset 以内的情况：
  // 如果页面已接近底部，选择视口中最近的可见标题
  if (!currentId || (document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 50)) {
    let minTop = Infinity
    for (const header of headers) {
      if (header) {
        const rect = header.getBoundingClientRect()
        if (rect.top >= 0 && rect.top < minTop) {
          minTop = rect.top
          currentId = header.id
        }
      }
    }
  }

  activeId.value = currentId || (outline.value[0]?.id ?? '')
}

/**
 * 点击目录项滚动到对应位置
 */
const scrollToHeader = (id: string) => {
  const element = document.getElementById(id)
  if (!element) return

  // 立即锁定 activeId，阻止 scroll spy 在平滑滚动期间覆盖
  activeId.value = id
  isClickScrolling = true

  const top = element.getBoundingClientRect().top + window.scrollY - 80
  window.scrollTo({ top, behavior: 'smooth' })
}

/**
 * 复制当前页面链接
 */
const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(pageUrl.value)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

/**
 * 分享反馈
 */
const shareFeedback = () => {
  const feedbackUrl = `https://github.com/your-repo/issues/new?title=Feedback: ${encodeURIComponent(page.value.title || '')}`
  window.open(feedbackUrl, '_blank')
}

/**
 * 复制页面内容
 */
const copyContent = async () => {
  try {
    const content = document.querySelector('.content-wrapper')?.textContent || ''
    await navigator.clipboard.writeText(content)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 监听 activeId 变化，自动滚动面板让激活项保持可见
// 注意：不能用 scrollIntoView，它会冒泡滚动整个页面
watch(activeId, (id) => {
  if (!id || !panelRef.value) return
  const activeEl = panelRef.value.querySelector<HTMLElement>(`a[href="#${CSS.escape(id)}"]`)
  if (!activeEl) return
  const panel = panelRef.value
  const panelRect = panel.getBoundingClientRect()
  const elRect = activeEl.getBoundingClientRect()
  if (elRect.top < panelRect.top) {
    panel.scrollTop += elRect.top - panelRect.top - 8
  } else if (elRect.bottom > panelRect.bottom) {
    panel.scrollTop += elRect.bottom - panelRect.bottom + 8
  }
})

// 监听页面变化重新构建目录
watch(() => page.value.relativePath, () => {
  setTimeout(buildOutline, 100)
}, { immediate: true })

// Docmost 内容加载完成后重建目录
const onDocmostContentLoaded = () => {
  setTimeout(buildOutline, 50)
}

/**
 * 统一 scroll 事件处理
 * 点击滚动期间：不更新 activeId，仅等待滚动停止后解锁
 * 正常滚动时：实时更新 activeId
 */
const onScroll = () => {
  if (isClickScrolling) {
    // 每次 scroll 事件重置计时器，直到滚动真正停下来
    if (scrollSettleTimer) clearTimeout(scrollSettleTimer)
    scrollSettleTimer = setTimeout(() => {
      isClickScrolling = false
    }, 150)
    return
  }
  updateActiveId()
}

onMounted(() => {
  setTimeout(buildOutline, 100)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('docmost-content-loaded', onDocmostContentLoaded)
  updateActiveId()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('docmost-content-loaded', onDocmostContentLoaded)
  if (scrollSettleTimer) clearTimeout(scrollSettleTimer)
})
</script>

<template>
  <aside ref="panelRef" class="right-panel" aria-label="页面导航和工具">
    <!-- 目录区域 -->
    <div class="outline-wrapper">
      <!-- 标题头 -->
      <div class="outline-header">
        <svg class="outline-header-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span>本页导航</span>
      </div>

      <nav v-if="outline.length > 0" class="outline-section" aria-label="页面目录">
        <a
          v-for="item in outline"
          :key="item.id"
          :href="`#${item.id}`"
          class="outline-link"
          :class="{
            'is-active': activeId === item.id,
            'is-h3': item.level === 3
          }"
          @click.prevent="scrollToHeader(item.id)"
        >
          {{ item.text }}
        </a>
      </nav>

      <!-- 工具栏区域 -->
      <div class="toolbar-section">
        <!-- 复制页面 -->
        <button
          class="toolbar-btn"
          type="button"
          @click="copyContent"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span class="toolbar-text">{{ copySuccess ? '已复制' : '复制页面' }}</span>
        </button>

        <!-- 分享反馈 -->
        <button
          class="toolbar-btn"
          type="button"
          @click="shareFeedback"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span class="toolbar-text">分享反馈</span>
        </button>

        <!-- 详细说明 -->
        <button
          class="toolbar-btn"
          type="button"
          @click="copyLink"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <span class="toolbar-text">详细说明</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ===== 面板容器 ===== */
.right-panel {
  position: fixed;
  top: calc(var(--navbar-height) + 24px);
  right: 16px;
  width: 220px;
  max-height: calc(100vh - var(--navbar-height) - 48px);
  overflow-y: auto;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}

/* 隐藏滚动条 - WebKit */
.right-panel::-webkit-scrollbar {
  display: none;
}

/* ===== 内容包装器（带边框容器） ===== */
.outline-wrapper {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg, 12px);
  background-color: var(--c-bg);
  padding: 12px 0;
}

/* ===== 标题头 ===== */
.outline-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  margin-bottom: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--c-border);
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-2, rgba(122, 121, 116, 1));
  user-select: none;
}

.outline-header-icon {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
}

/* ===== 目录区域 ===== */
.outline-section {
  display: flex;
  flex-direction: column;
  padding-top: 4px;
}

.outline-link {
  display: block;
  color: rgba(122, 121, 116, 1);
  text-decoration: none;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 400;
  padding: 4px 16px;
  border-left: 3px solid transparent;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.outline-link:hover {
  color: rgba(38, 37, 30, 1);
}

.outline-link.is-active {
  color: #2563eb;
  border-left-color: #2563eb;
  font-weight: 500;
}

.outline-link.is-h3 {
  padding-left: 28px;
  color: rgba(122, 121, 116, 0.8);
}

.outline-link.is-h3:hover {
  color: rgba(38, 37, 30, 1);
}

.outline-link.is-h3.is-active {
  color: #2563eb;
  border-left-color: #2563eb;
}

/* ===== 工具栏区域 ===== */
.toolbar-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--c-border);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 28px;
  border: none;
  background-color: transparent;
  color: rgba(122, 121, 116, 1);
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 400;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.toolbar-btn:hover {
  color: rgba(38, 37, 30, 1);
}

.toolbar-btn:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.toolbar-btn svg {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.toolbar-text {
  font-size: 13px;
  line-height: 1.4;
}

/* ===== 暗色模式 ===== */
:root.dark .outline-wrapper {
  border-color: rgba(255, 255, 255, 0.1);
  background-color: var(--c-bg);
}

:root.dark .outline-header {
  color: rgba(156, 155, 150, 1);
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

:root.dark .outline-link {
  color: rgba(156, 155, 150, 1);
}

:root.dark .outline-link:hover {
  color: rgba(236, 236, 231, 1);
}

:root.dark .outline-link.is-active {
  color: #60a5fa;
  border-left-color: #60a5fa;
}

:root.dark .outline-link.is-h3 {
  color: rgba(156, 155, 150, 0.8);
}

:root.dark .outline-link.is-h3:hover {
  color: rgba(236, 236, 231, 1);
}

:root.dark .outline-link.is-h3.is-active {
  color: #60a5fa;
  border-left-color: #60a5fa;
}

:root.dark .toolbar-section {
  border-top-color: rgba(255, 255, 255, 0.08);
}

:root.dark .toolbar-btn {
  color: rgba(156, 155, 150, 1);
}

:root.dark .toolbar-btn:hover {
  color: rgba(236, 236, 231, 1);
}

/* ===== 响应式 ===== */
@media (max-width: 1280px) {
  .right-panel {
    display: none;
  }
}
</style>
