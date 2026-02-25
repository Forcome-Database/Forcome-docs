<script setup lang="ts">
/**
 * 侧边栏组件
 * 目录结构渲染、拖拽手柄、移动端遮罩
 * 
 * 需求: 3.1-3.7, 4.1-4.8
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useData, useRoute } from 'vitepress'
import SideBarItem from './SideBarItem.vue'
import type { SidebarItem } from '../types'
import { useDocmostSidebar } from '../composables/useDocmostSidebar'

const props = defineProps<{
  /** 侧边栏宽度（桌面端） */
  width: number
  /** 移动端是否打开 */
  isOpen: boolean
  /** 是否正在拖拽 */
  isDragging?: boolean
  /** 是否为移动端 */
  isMobile?: boolean
}>()

const emit = defineEmits<{
  /** 更新宽度 */
  (e: 'update:width', width: number): void
  /** 关闭侧边栏（移动端） */
  (e: 'close'): void
  /** 开始拖拽 */
  (e: 'start-drag', event: MouseEvent | TouchEvent): void
}>()

// 获取 VitePress 数据
const { theme } = useData()
const route = useRoute()

// Docmost 动态侧边栏
const { isAvailable: hasDocmost, loadSpaces, sidebarData, spaces: docmostSpaces, buildSidebarForRoute, isDocmostRoute, isLoaded: docmostLoaded } = useDocmostSidebar()

// 初始化时加载 Docmost 数据
onMounted(() => {
  if (hasDocmost.value) {
    loadSpaces()
  }
})

/**
 * 侧边栏数据
 */
const sidebarGroups = ref<SidebarItem[]>([])

/**
 * 构建静态侧边栏（VitePress 原生）
 */
function getStaticSidebar(path: string): SidebarItem[] {
  const sidebar = theme.value.sidebar
  if (!sidebar) return []
  if (Array.isArray(sidebar)) return sidebar as SidebarItem[]

  const sortedKeys = Object.keys(sidebar).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (path.startsWith(key)) return sidebar[key] as SidebarItem[]
  }
  return sidebar['/'] ? sidebar['/'] as SidebarItem[] : []
}

/**
 * 更新侧边栏内容
 */
function updateSidebar() {
  const path = route.path
  if (hasDocmost.value && isDocmostRoute(path) && docmostLoaded.value) {
    sidebarGroups.value = buildSidebarForRoute(path)
  } else if (!isDocmostRoute(path)) {
    sidebarGroups.value = getStaticSidebar(path)
  }
}

// 路由变化时更新
watch(() => route.path, updateSidebar, { immediate: true })

// Docmost 数据加载完成时更新（关键：显式监听 isLoaded 变化）
watch(docmostLoaded, (loaded) => {
  if (loaded) updateSidebar()
})

/**
 * 处理导航（移动端关闭侧边栏）
 */
const handleNavigate = () => {
  if (props.isMobile && props.isOpen) {
    emit('close')
  }
}

/**
 * 处理拖拽开始
 */
const handleDragStart = (e: MouseEvent | TouchEvent) => {
  emit('start-drag', e)
}

/**
 * 处理键盘调整宽度（可访问性）
 */
const handleResizeKeydown = (e: KeyboardEvent) => {
  const step = 10 // 每次调整 10px
  let newWidth = props.width
  
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    newWidth = Math.max(200, props.width - step)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    newWidth = Math.min(400, props.width + step)
  } else if (e.key === 'Home') {
    e.preventDefault()
    newWidth = 200
  } else if (e.key === 'End') {
    e.preventDefault()
    newWidth = 400
  }
  
  if (newWidth !== props.width) {
    emit('update:width', newWidth)
  }
}

/**
 * 侧边栏样式
 */
const sidebarStyle = computed(() => {
  if (props.isMobile) {
    return {}
  }
  return {
    width: `${props.width}px`
  }
})
</script>

<template>
  <!-- 移动端遮罩层 -->
  <Transition name="sidebar-overlay">
    <div
      v-if="isOpen && isMobile"
      class="sidebar-overlay"
      @click="emit('close')"
      aria-hidden="true"
    />
  </Transition>

  <!-- 侧边栏主体 -->
  <aside
    class="sidebar"
    :class="{
      'is-open': isOpen,
      'is-dragging': isDragging,
      'is-mobile': isMobile
    }"
    :style="sidebarStyle"
    role="navigation"
    aria-label="文档导航"
  >
    <!-- 侧边栏内容 -->
    <div class="sidebar-content">
      <nav class="sidebar-nav">
        <!-- 渲染侧边栏分组 -->
        <template v-for="(group, index) in sidebarGroups" :key="group.text || index">
          <!-- 分组标题（如果有 text 但没有 link，且没有 collapsed 属性） -->
          <div v-if="group.text && !group.link && group.items && group.collapsed === undefined" class="sidebar-group">
            <div class="sidebar-group-title">{{ group.text }}</div>
            <div class="sidebar-group-items">
              <SideBarItem
                v-for="(item, itemIndex) in group.items"
                :key="item.link || itemIndex"
                :item="item"
                :depth="0"
                @navigate="handleNavigate"
              />
            </div>
          </div>

          <!-- 可折叠分组或普通项 -->
          <SideBarItem
            v-else
            :item="group"
            :depth="0"
            @navigate="handleNavigate"
          />
        </template>

        <!-- 空状态 -->
        <div v-if="sidebarGroups.length === 0" class="sidebar-empty">
          暂无导航内容
        </div>
      </nav>
    </div>

    <!-- 拖拽手柄（桌面端） -->
    <div
      v-if="!isMobile"
      class="sidebar-resize-handle"
      @mousedown="handleDragStart"
      @touchstart="handleDragStart"
      @keydown="handleResizeKeydown"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度，使用左右箭头键调整"
      aria-valuenow="width"
      :aria-valuemin="200"
      :aria-valuemax="400"
      tabindex="0"
    />
  </aside>
</template>

<style scoped>
/* ===== 侧边栏遮罩层 ===== */

.sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-sidebar) - 1);
  background-color: rgba(0, 0, 0, 0.5);
}

/* 遮罩层过渡动画 */
.sidebar-overlay-enter-active,
.sidebar-overlay-leave-active {
  transition: opacity var(--transition-normal);
}

.sidebar-overlay-enter-from,
.sidebar-overlay-leave-to {
  opacity: 0;
}

/* ===== 侧边栏主体 ===== */

.sidebar {
  position: fixed;
  top: var(--navbar-height);
  left: 0;
  bottom: 0;
  z-index: var(--z-sidebar);
  width: var(--sidebar-width);
  background-color: #f5f5f0;
  border-right: 1px solid var(--c-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* 主题切换过渡 */
  transition:
    background-color var(--transition-normal),
    border-color var(--transition-normal),
    transform var(--transition-normal),
    width var(--transition-fast);
}

/* 暗色模式侧边栏背景 */
:root.dark .sidebar {
  background-color: #1a1a1a;
}

/* 拖拽时禁用宽度过渡 */
.sidebar.is-dragging {
  transition:
    background-color var(--transition-normal),
    border-color var(--transition-normal),
    transform var(--transition-normal);
  user-select: none;
}

/* 移动端样式 */
.sidebar.is-mobile {
  width: var(--sidebar-width);
  transform: translateX(-100%);
  box-shadow: var(--shadow-lg);
}

.sidebar.is-mobile.is-open {
  transform: translateX(0);
}

/* ===== 侧边栏内容 ===== */

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  padding-bottom: var(--spacing-12);
}

/* 自定义滚动条 */
.sidebar-content::-webkit-scrollbar {
  width: 6px;
}

.sidebar-content::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-content::-webkit-scrollbar-thumb {
  background-color: var(--c-border);
  border-radius: 3px;
}

.sidebar-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--c-border-dark);
}

/* ===== 侧边栏导航 ===== */

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

/* ===== 分组样式 ===== */

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.sidebar-group + .sidebar-group {
  margin-top: var(--spacing-6);
}

.sidebar-group-title {
  padding: 0 0 8px 0;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 400;
  color: rgba(122, 121, 116, 1);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  line-height: 18px;
}

:root.dark .sidebar-group-title {
  color: rgba(156, 155, 150, 1);
}

.sidebar-group-items {
  display: flex;
  flex-direction: column;
}

/* ===== 空状态 ===== */

.sidebar-empty {
  padding: var(--spacing-4);
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--font-size-sm);
}

/* ===== 拖拽手柄 ===== */

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  background-color: transparent;
  opacity: 0;
  transition:
    background-color var(--transition-fast),
    opacity var(--transition-fast);
}

.sidebar-resize-handle:hover,
.sidebar.is-dragging .sidebar-resize-handle {
  background-color: var(--c-accent);
  opacity: 1;
}

/* 拖拽手柄焦点样式（键盘可访问性） */
.sidebar-resize-handle:focus {
  outline: none;
  background-color: var(--c-accent);
  opacity: 1;
}

/* ===== 响应式 ===== */

@media (max-width: 1023px) {
  .sidebar:not(.is-mobile) {
    transform: translateX(-100%);
  }
}
</style>
