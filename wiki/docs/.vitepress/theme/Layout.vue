<script setup lang="ts">
/**
 * 根布局组件
 * Cursor 风格文档平台
 * 
 * 职责：管理整体页面结构和全局状态
 * 需求: 1.1-1.6, 8.1-8.7, 14.5
 */
import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue'
import { useData, Content, useRoute } from 'vitepress'
import { useTheme } from './composables/useTheme'
import { useSidebar } from './composables/useSidebar'
import { useLazyImages } from './composables/useLazyImages'
import NavBar from './components/NavBar.vue'
import SideBar from './components/SideBar.vue'
import RightPanel from './components/RightPanel.vue'
import MobileMenu from './components/MobileMenu.vue'
import SearchModal from './components/SearchModal.vue'
import AIChat from './components/AIChat.vue'
import NotFound from './components/NotFound.vue'
import DocmostContent from './components/DocmostContent.vue'
import { useDocmostSidebar } from './composables/useDocmostSidebar'
import { useAuth } from './composables/useAuth'

// 获取 VitePress 数据
const { frontmatter, page } = useData()
const route = useRoute()

// Auth 初始化
const { initAuth } = useAuth()

// Docmost 数据预加载
const { loadSpaces, isAvailable: hasDocmost, isDocmostRoute: checkDocmostRoute } = useDocmostSidebar()

/**
 * 是否为 Docmost 路由
 */
const isDocmostRoute = computed(() => checkDocmostRoute(route.path))

/**
 * 是否为 404 页面（Docmost 路由不算 404）
 */
const is404 = computed(() => page.value.isNotFound && !isDocmostRoute.value)

// 主题状态（初始化主题）
useTheme()

// 侧边栏状态
const {
  width: sidebarWidth,
  isOpen: isSidebarOpen,
  isDragging: isSidebarDragging,
  isMobile,
  startDrag,
  toggle: toggleSidebar,
  close: closeSidebar
} = useSidebar()

// 搜索模态框状态
const isSearchOpen = ref(false)

// AI 问答面板状态
const isAIChatOpen = ref(false)

/**
 * 是否显示侧边栏
 * 根据 frontmatter 配置决定
 */
const hasSidebar = computed(() => {
  return frontmatter.value.sidebar !== false
})

/**
 * 布局样式
 */
const layoutStyle = computed(() => ({
  '--sidebar-width-current': `${sidebarWidth.value}px`
}))

// ===== 搜索功能 =====

const openSearch = () => {
  isSearchOpen.value = true
}

const closeSearch = () => {
  isSearchOpen.value = false
}

const toggleSearch = () => {
  isSearchOpen.value = !isSearchOpen.value
}

// ===== AI 问答功能 =====

const closeAIChat = () => {
  isAIChatOpen.value = false
}

const toggleAIChat = () => {
  isAIChatOpen.value = !isAIChatOpen.value
}

// ===== 快捷键处理 =====

const handleKeydown = (e: KeyboardEvent) => {
  // ⌘K / Ctrl+K 打开搜索（需求 5.1）
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    toggleSearch()
  }
  
  // ⌘I / Ctrl+I 打开 AI 问答（需求 6.1）
  if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
    e.preventDefault()
    toggleAIChat()
  }
  
  // ESC 关闭模态框
  if (e.key === 'Escape') {
    if (isSearchOpen.value) {
      closeSearch()
    }
    if (isAIChatOpen.value) {
      closeAIChat()
    }
    if (isSidebarOpen.value && isMobile.value) {
      closeSidebar()
    }
  }
}

// ===== 提供给子组件的注入 =====

provide('layout', {
  toggleSidebar,
  toggleSearch,
  toggleAIChat,
  sidebarWidth
})

// ===== 生命周期 =====

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  // 初始化认证状态
  initAuth()
  // 初始化 Docmost 数据（在 Layout 层确保最早加载）
  if (hasDocmost.value) {
    loadSpaces()
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div 
    class="layout" 
    :class="{ 
      'sidebar-open': isSidebarOpen,
      'search-open': isSearchOpen,
      'ai-chat-open': isAIChatOpen
    }"
    :style="layoutStyle"
  >
    <!-- 跳过导航链接（可访问性：需求 13.1） -->
    <a href="#main-content" class="skip-link">
      跳转到主要内容
    </a>

    <!-- 顶部导航栏 -->
    <NavBar
      @toggle-sidebar="toggleSidebar"
      @open-search="openSearch"
      @toggle-ai-chat="toggleAIChat"
    />

    <!-- 主体区域 -->
    <div class="layout-main">
      <!-- 左侧边栏（桌面端，404 页面不显示） -->
      <SideBar
        v-if="hasSidebar && !isMobile && !is404"
        :width="sidebarWidth"
        :is-open="isSidebarOpen"
        :is-dragging="isSidebarDragging"
        :is-mobile="isMobile"
        @close="closeSidebar"
        @start-drag="startDrag"
      />

      <!-- 主内容区 -->
      <main
        id="main-content"
        class="content-container"
        :style="{ marginLeft: hasSidebar && !isMobile && !is404 ? `${sidebarWidth}px` : '0' }"
        role="main"
        tabindex="-1"
      >
        <article class="content-wrapper vp-doc">
          <!-- 404 页面 -->
          <NotFound v-if="is404" />
          <!-- Docmost 动态内容 -->
          <DocmostContent v-else-if="isDocmostRoute" />
          <!-- 正常 VitePress 内容 -->
          <Content v-else />
        </article>
      </main>

      <!-- 右侧面板：目录 + 工具栏（桌面端，404 页面不显示） -->
      <RightPanel v-if="!is404 && !isMobile" />
    </div>

    <!-- 搜索模态框（需求 5.1-5.10） -->
    <SearchModal
      v-if="isSearchOpen"
      @close="closeSearch"
    />

    <!-- AI 问答面板（需求 6.1-6.12） -->
    <Transition name="ai-panel">
      <AIChat
        v-if="isAIChatOpen"
        @close="closeAIChat"
      />
    </Transition>

    <!-- 移动端菜单（需求 1.4, 1.5, 8.2） -->
    <MobileMenu
      :is-open="isSidebarOpen && isMobile"
      @close="closeSidebar"
    />
  </div>
</template>

<style scoped>
/* ===== 跳过导航链接（可访问性） ===== */

.skip-link {
  position: absolute;
  top: -100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: calc(var(--z-modal) + 1);
  padding: var(--spacing-3) var(--spacing-4);
  background-color: var(--c-bg);
  border: 2px solid var(--c-accent);
  border-radius: var(--radius-md);
  color: var(--c-accent);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  transition: top var(--transition-fast);
}

.skip-link:focus {
  top: var(--spacing-2);
  outline: none;
}

/* ===== 过渡动画 ===== */

/* AI 面板过渡 */
.ai-panel-enter-active,
.ai-panel-leave-active {
  transition: opacity var(--transition-normal);
}

.ai-panel-enter-active :deep(.ai-chat-panel),
.ai-panel-leave-active :deep(.ai-chat-panel) {
  transition: transform var(--transition-normal);
}

.ai-panel-enter-active :deep(.ai-chat-overlay),
.ai-panel-leave-active :deep(.ai-chat-overlay) {
  transition: opacity var(--transition-normal);
}

.ai-panel-enter-from,
.ai-panel-leave-to {
  opacity: 0;
}

.ai-panel-enter-from :deep(.ai-chat-panel),
.ai-panel-leave-to :deep(.ai-chat-panel) {
  transform: translateX(100%);
}

.ai-panel-enter-from :deep(.ai-chat-overlay),
.ai-panel-leave-to :deep(.ai-chat-overlay) {
  opacity: 0;
}
</style>
