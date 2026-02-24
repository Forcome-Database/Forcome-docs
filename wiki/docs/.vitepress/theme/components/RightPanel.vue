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
 */
const updateActiveId = () => {
  if (typeof window === 'undefined') return

  const headers = outline.value.map(item => document.getElementById(item.id)).filter(Boolean)
  
  let currentId = ''
  const scrollTop = window.scrollY
  const offset = 100

  for (const header of headers) {
    if (header && header.offsetTop <= scrollTop + offset) {
      currentId = header.id
    }
  }

  activeId.value = currentId || (outline.value[0]?.id ?? '')
}

/**
 * 点击目录项滚动到对应位置
 */
const scrollToHeader = (id: string) => {
  const element = document.getElementById(id)
  if (element) {
    const top = element.offsetTop - 80
    window.scrollTo({ top, behavior: 'smooth' })
  }
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

// 监听页面变化重新构建目录
watch(() => page.value.relativePath, () => {
  setTimeout(buildOutline, 100)
}, { immediate: true })

onMounted(() => {
  setTimeout(buildOutline, 100)
  window.addEventListener('scroll', updateActiveId, { passive: true })
  updateActiveId()
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateActiveId)
})
</script>

<template>
  <aside class="right-panel" aria-label="页面导航和工具">
    <!-- 目录区域 -->
    <div class="outline-wrapper">
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
.right-panel {
  position: fixed;
  top: calc(var(--navbar-height) + 32px);
  right: 16px;
  width: 200px;
  max-height: calc(100vh - var(--navbar-height) - 64px);
  overflow-y: auto;
}

.outline-wrapper {
  display: flex;
  flex-direction: column;
  padding: 0 8px;
}

/* 目录区域 */
.outline-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.outline-link {
  display: block;
  color: rgba(122, 121, 116, 1);
  text-decoration: none;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  transition: color 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-link:hover {
  color: rgba(38, 37, 30, 1);
}

.outline-link.is-active {
  color: rgba(38, 37, 30, 1);
}

.outline-link.is-h3 {
  padding-left: 12px;
  color: rgba(122, 121, 116, 0.8);
}

.outline-link.is-h3:hover,
.outline-link.is-h3.is-active {
  color: rgba(38, 37, 30, 1);
}

/* 工具栏区域 */
.toolbar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

:root.dark .toolbar-section {
  border-top-color: rgba(255, 255, 255, 0.08);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  height: 24px;
  border: none;
  background-color: transparent;
  color: rgba(122, 121, 116, 1);
  cursor: pointer;
  font-size: 14px;
  line-height: 20px;
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
  width: 16px;
  height: 16px;
}

.toolbar-text {
  font-size: 14px;
  line-height: 20px;
}

/* 隐藏滚动条 */
.right-panel::-webkit-scrollbar {
  width: 0;
}

/* 暗色模式适配 */
:root.dark .outline-link {
  color: rgba(156, 155, 150, 1);
}

:root.dark .outline-link:hover,
:root.dark .outline-link.is-active {
  color: rgba(236, 236, 231, 1);
}

:root.dark .outline-link.is-h3 {
  color: rgba(156, 155, 150, 0.8);
}

:root.dark .outline-link.is-h3:hover,
:root.dark .outline-link.is-h3.is-active {
  color: rgba(236, 236, 231, 1);
}

:root.dark .toolbar-btn {
  color: rgba(156, 155, 150, 1);
}

:root.dark .toolbar-btn:hover {
  color: rgba(236, 236, 231, 1);
}

/* 响应式 */
@media (max-width: 1280px) {
  .right-panel {
    display: none;
  }
}
</style>
