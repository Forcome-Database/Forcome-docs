<script setup lang="ts">
/**
 * Markmap 交互式脑图组件
 * 支持节点展开/收缩、全屏模式、暗色模式
 */
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'

const props = defineProps<{
  // Markdown 格式的脑图内容
  content?: string
  // Base64 编码的内容（从 markdown 代码块传入）
  contentBase64?: string
  // 高度
  height?: number
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)
let markmapInstance: Markmap | null = null
let svgObserver: MutationObserver | null = null
let themeObserver: MutationObserver | null = null
const transformer = new Transformer()

// 获取实际内容
const getContent = () => {
  // 优先使用 base64 编码的内容
  if (props.contentBase64) {
    try {
      return decodeURIComponent(escape(atob(props.contentBase64)))
    } catch {
      return ''
    }
  }
  return props.content || ''
}

// 检测当前是否为暗色模式
const checkIsDark = () => document.documentElement.classList.contains('dark')

// 获取当前主题的文字颜色
const getTextColor = () => checkIsDark() ? '#e5e7eb' : '#1f2937'

// 更新所有文字颜色
const updateTextColor = () => {
  if (!svgRef.value) return
  const color = getTextColor()
  svgRef.value.querySelectorAll('text').forEach(text => {
    text.setAttribute('fill', color)
  })
}

// 渲染脑图
const renderMarkmap = () => {
  if (!svgRef.value) return
  
  const content = getContent()
  if (!content) return

  // 清空之前的内容
  svgRef.value.innerHTML = ''

  // 转换 Markdown 为脑图数据
  const { root } = transformer.transform(content)

  // 创建 Markmap 实例
  markmapInstance = Markmap.create(svgRef.value, {
    autoFit: true,
    duration: 300,
    maxWidth: 300,
    paddingX: 16,
    color: () => checkIsDark() ? '#60a5fa' : '#3b82f6'
  }, root)

  // 初始更新文字颜色
  setTimeout(updateTextColor, 100)
}

// 容器高度
const containerHeight = computed(() => props.height ? `${props.height}px` : '400px')

// 切换全屏
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  nextTick(() => {
    markmapInstance?.fit()
  })
}

// ESC 退出全屏
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
    nextTick(() => markmapInstance?.fit())
  }
}

onMounted(() => {
  nextTick(renderMarkmap)
  document.addEventListener('keydown', handleKeydown)

  // 监听 SVG DOM 变化，确保新增节点也有正确颜色
  if (svgRef.value) {
    svgObserver = new MutationObserver(() => {
      updateTextColor()
    })
    svgObserver.observe(svgRef.value, {
      childList: true,
      subtree: true
    })
  }

  // 监听 html 元素的 class 变化（主题切换）
  themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        updateTextColor()
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
  svgObserver?.disconnect()
  themeObserver?.disconnect()
})
</script>

<template>
  <div 
    ref="containerRef"
    class="markmap-container"
    :class="{ 'is-fullscreen': isFullscreen }"
    :style="{ height: containerHeight }"
  >
    <div class="markmap-toolbar">
      <button 
        class="toolbar-btn" 
        @click="toggleFullscreen"
        :title="isFullscreen ? '退出全屏 (ESC)' : '全屏'"
      >
        <svg v-if="!isFullscreen" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
        </svg>
      </button>
      <button 
        class="toolbar-btn" 
        @click="markmapInstance?.fit()"
        title="适应视图"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </button>
    </div>
    <svg ref="svgRef" class="markmap-svg"></svg>
  </div>
</template>

<style scoped>
.markmap-container {
  position: relative;
  width: 100%;
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg);
}

.markmap-container.is-fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh !important;
  z-index: 9999;
  border-radius: 0;
  border: none;
  margin: 0;
}

.markmap-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  z-index: 10;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.markmap-svg {
  width: 100%;
  height: 100%;
}

/* 强制覆盖 markmap 文字颜色 */
.markmap-svg :deep(text) {
  fill: var(--vp-c-text-1) !important;
}
</style>
