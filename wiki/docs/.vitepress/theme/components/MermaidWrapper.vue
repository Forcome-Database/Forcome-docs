<script setup lang="ts">
/**
 * Mermaid 图表容器组件
 * 提供全屏、缩放、复制代码等功能
 */
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import mermaid from 'mermaid'

const props = defineProps<{
  // Mermaid 图表代码（Base64 编码）
  contentBase64?: string
  // 直接传入的代码
  content?: string
  // 高度
  height?: number
  // 图表标题
  title?: string
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const chartRef = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)
const scale = ref(1)
const chartId = ref(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// 获取实际内容
const getContent = () => {
  if (props.contentBase64) {
    try {
      return decodeURIComponent(escape(atob(props.contentBase64)))
    } catch {
      return ''
    }
  }
  return props.content || ''
}

// 容器高度
const containerHeight = computed(() => props.height ? `${props.height}px` : '400px')

// 渲染图表
const renderChart = async () => {
  if (!chartRef.value) return
  
  const content = getContent()
  if (!content) return

  try {
    // 初始化 mermaid
    mermaid.initialize({
      startOnLoad: false,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      securityLevel: 'loose'
    })

    const { svg } = await mermaid.render(chartId.value, content)
    chartRef.value.innerHTML = svg
  } catch (error) {
    console.error('Mermaid render error:', error)
    chartRef.value.innerHTML = `<div class="error">图表渲染失败</div>`
  }
}

// 切换全屏
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  scale.value = 1
}

// 缩放
const zoomIn = () => {
  scale.value = Math.min(scale.value + 0.2, 3)
}

const zoomOut = () => {
  scale.value = Math.max(scale.value - 0.2, 0.5)
}

const resetZoom = () => {
  scale.value = 1
}

// 复制代码
const copyCode = async () => {
  const content = getContent()
  try {
    await navigator.clipboard.writeText(content)
    // 可以添加 toast 提示
  } catch {
    console.error('复制失败')
  }
}

// ESC 退出全屏
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
    scale.value = 1
  }
}

// 监听主题变化
let themeObserver: MutationObserver | null = null

onMounted(() => {
  nextTick(renderChart)
  document.addEventListener('keydown', handleKeydown)

  // 监听主题切换
  themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        // 重新生成 ID 避免冲突
        chartId.value = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`
        nextTick(renderChart)
        break
      }
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  themeObserver?.disconnect()
})
</script>

<template>
  <div 
    ref="containerRef"
    class="mermaid-wrapper"
    :class="{ 'is-fullscreen': isFullscreen }"
    :style="{ height: isFullscreen ? '100vh' : containerHeight }"
  >
    <!-- 标题栏 -->
    <div v-if="title" class="mermaid-title">{{ title }}</div>
    
    <!-- 工具栏 -->
    <div class="mermaid-toolbar">
      <button class="toolbar-btn" @click="zoomOut" title="缩小">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>
        </svg>
      </button>
      <span class="zoom-level">{{ Math.round(scale * 100) }}%</span>
      <button class="toolbar-btn" @click="zoomIn" title="放大">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>
        </svg>
      </button>
      <button class="toolbar-btn" @click="resetZoom" title="重置缩放">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
        </svg>
      </button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" @click="copyCode" title="复制代码">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
      </button>
      <button class="toolbar-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏 (ESC)' : '全屏'">
        <svg v-if="!isFullscreen" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
        </svg>
      </button>
    </div>

    <!-- 图表容器 -->
    <div class="mermaid-content" :style="{ transform: `scale(${scale})` }">
      <div ref="chartRef" class="mermaid-chart"></div>
    </div>
  </div>
</template>

<style scoped>
.mermaid-wrapper {
  position: relative;
  width: 100%;
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg);
}

.mermaid-wrapper.is-fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  z-index: 9999;
  border-radius: 0;
  border: none;
  margin: 0;
}

.mermaid-title {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.mermaid-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 10;
  padding: 4px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.zoom-level {
  font-size: 12px;
  color: var(--vp-c-text-2);
  min-width: 40px;
  text-align: center;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--vp-c-divider);
  margin: 0 4px;
}

.mermaid-content {
  width: 100%;
  height: calc(100% - 44px);
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
  transition: transform 0.2s ease;
}

.mermaid-chart {
  padding: 20px;
}

.mermaid-chart :deep(svg) {
  max-width: 100%;
  height: auto;
}

.mermaid-chart .error {
  color: var(--vp-c-danger-1);
  padding: 20px;
}
</style>
