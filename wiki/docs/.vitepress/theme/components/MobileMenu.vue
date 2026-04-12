<script setup lang="ts">
/**
 * 移动端菜单组件
 * 抽屉式侧边栏，从左侧滑入
 * 
 * 需求: 1.4, 1.5, 8.2
 */
import { computed, watch, onMounted, onUnmounted } from 'vue'
import { useData, useRoute } from 'vitepress'
import SideBarItem from './SideBarItem.vue'
import CloseIcon from './icons/CloseIcon.vue'
import { useDocmostSidebar } from '../composables/useDocmostSidebar'
import type { SidebarItem } from '../types'

const props = defineProps<{
  /** 是否打开 */
  isOpen: boolean
}>()

const emit = defineEmits<{
  /** 关闭菜单 */
  (e: 'close'): void
}>()

// 获取 VitePress 数据
const { theme } = useData()
const route = useRoute()
const {
  spaces: docmostSpaces,
  directories: docmostDirectories,
  selectedDirectoryId,
  selectDirectory,
  isLoaded: docmostLoaded,
  isDocmostRoute,
} = useDocmostSidebar()

// 从路由路径中提取当前语言
const currentLang = computed(() => {
  const match = route.path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
})

// 从静态导航中提取已覆盖的空间 slug 集合
function extractStaticSlugs(items: any[]): Set<string> {
  const slugs = new Set<string>()
  for (const item of items) {
    if (item.link) {
      const match = item.link.match(/\/(?:zh|en|vi)\/docs\/([^/]+)/)
      if (match) slugs.add(match[1])
    }
    if (item.items) {
      for (const child of item.items) {
        if (child.link) {
          const match = child.link.match(/\/(?:zh|en|vi)\/docs\/([^/]+)/)
          if (match) slugs.add(match[1])
        }
      }
    }
  }
  return slugs
}

/**
 * 获取当前页面的侧边栏配置
 */
const sidebarGroups = computed(() => {
  const sidebar = theme.value.sidebar
  
  if (!sidebar) return []
  
  // 如果是数组，直接返回
  if (Array.isArray(sidebar)) {
    return sidebar as SidebarItem[]
  }
  
  // 如果是对象，根据当前路径匹配
  const path = route.path
  
  // 尝试精确匹配
  for (const key of Object.keys(sidebar)) {
    if (path.startsWith(key)) {
      return sidebar[key] as SidebarItem[]
    }
  }
  
  // 默认返回根路径配置
  if (sidebar['/']) {
    return sidebar['/'] as SidebarItem[]
  }
  
  return []
})

/**
 * 导航项：静态配置 + 动态发现的 Docmost 空间（与 NavBar 一致）
 */
const navItems = computed(() => {
  const staticNav = theme.value.nav || []
  const coveredSlugs = extractStaticSlugs(staticNav)
  const lang = currentLang.value

  const dynamicItems = docmostSpaces.value
    .filter((space) => !coveredSlugs.has(space.slug))
    .map((space) => {
      const dirs = docmostDirectories.value[space.slug]

      if (space.hasDirectories && dirs && dirs.length > 0) {
        return {
          text: space.name,
          link: `/${lang}/docs/${space.slug}/`,
          items: dirs.map((dir) => ({
            text: dir.icon ? `${dir.icon} ${dir.name}` : dir.name,
            directoryId: dir.id,
            spaceSlug: space.slug,
            link: `/${lang}/docs/${space.slug}/`,
          })),
        }
      }

      return {
        text: space.name,
        link: `/${lang}/docs/${space.slug}/`,
      }
    })

  if (dynamicItems.length === 0) return staticNav
  return [...staticNav, ...dynamicItems]
})

/**
 * 处理导航点击（关闭菜单）
 */
const handleNavigate = () => {
  emit('close')
}

/**
 * 处理目录项点击
 */
const handleDirectoryClick = (event: Event, child: any) => {
  if (child.directoryId && child.spaceSlug) {
    event.preventDefault()
    selectDirectory(child.spaceSlug, child.directoryId)
  }
  emit('close')
}

/**
 * 处理遮罩层点击
 */
const handleOverlayClick = () => {
  emit('close')
}

/**
 * 处理 ESC 键关闭
 */
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.isOpen) {
    emit('close')
  }
}

/**
 * 监听打开状态，控制 body 滚动
 */
watch(() => props.isOpen, (isOpen) => {
  if (typeof document === 'undefined') return
  
  if (isOpen) {
    // 防止背景滚动
    document.body.style.overflow = 'hidden'
  } else {
    // 恢复背景滚动
    document.body.style.overflow = ''
  }
})

/**
 * 监听路由变化，自动关闭菜单
 */
watch(() => route.path, () => {
  if (props.isOpen) {
    emit('close')
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  // 确保恢复 body 滚动
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩层 -->
    <Transition name="mobile-menu-overlay">
      <div
        v-if="isOpen"
        class="mobile-menu-overlay"
        @click="handleOverlayClick"
        aria-hidden="true"
      />
    </Transition>

    <!-- 抽屉式菜单 -->
    <Transition name="mobile-menu">
      <aside
        v-if="isOpen"
        id="mobile-menu"
        class="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="导航菜单"
      >
        <!-- 菜单头部 -->
        <header class="mobile-menu-header">
          <a href="/" class="mobile-menu-logo" aria-label="FORCOME 知识库首页" @click="handleNavigate">
            <img src="/images/logo/logo.png" alt="Logo" class="mobile-menu-logo-img" />
            <span class="logo-text" aria-hidden="true">{{ theme.siteTitle || 'FORCOME 知识库' }}</span>
          </a>
          <button
            class="mobile-menu-close"
            type="button"
            @click="emit('close')"
            aria-label="关闭菜单"
          >
            <CloseIcon :size="20" />
          </button>
        </header>

        <!-- 统一可滚动区域：主导航 + 侧边栏内容 -->
        <div class="mobile-menu-content">
          <!-- 主导航链接 -->
          <nav class="mobile-menu-nav" aria-label="主导航">
            <template v-for="item in navItems" :key="item.text">
              <!-- 带子菜单的导航项 -->
              <div v-if="item.items && item.items.length" class="mobile-nav-group">
                <a
                  :href="item.link"
                  class="mobile-nav-link"
                  @click="handleNavigate"
                >
                  {{ item.text }}
                </a>
                <div class="mobile-nav-sub">
                  <a
                    v-for="child in item.items"
                    :key="child.directoryId || child.text"
                    :href="child.link"
                    class="mobile-nav-sub-link"
                    :class="{ 'is-active': child.directoryId && selectedDirectoryId[child.spaceSlug] === child.directoryId }"
                    @click="handleDirectoryClick($event, child)"
                  >
                    {{ child.text }}
                  </a>
                </div>
              </div>
              <!-- 普通导航项 -->
              <a
                v-else
                :href="item.link"
                class="mobile-nav-link"
                @click="handleNavigate"
              >
                {{ item.text }}
              </a>
            </template>
          </nav>

          <!-- 分隔线 -->
          <div class="mobile-menu-divider" />

          <!-- 侧边栏内容 -->
          <nav class="mobile-sidebar-nav">
            <!-- 渲染侧边栏分组 -->
            <template v-for="(group, index) in sidebarGroups" :key="group.text || index">
              <!-- 分组标题 -->
              <div v-if="group.text && !group.link && group.items && group.collapsed === undefined" class="mobile-sidebar-group">
                <div class="mobile-sidebar-group-title">{{ group.text }}</div>
                <div class="mobile-sidebar-group-items">
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

            <!-- 加载骨架屏（仅 Docmost 路由等待 API 时显示） -->
            <div v-if="sidebarGroups.length === 0 && isDocmostRoute(route.path) && !docmostLoaded" class="mobile-sidebar-skeleton">
              <div v-for="i in 4" :key="i" class="skeleton-item">
                <div class="skeleton-line" :style="{ width: `${50 + (i % 3) * 20}%` }" />
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else-if="sidebarGroups.length === 0" class="mobile-sidebar-empty">
              暂无导航内容
            </div>
          </nav>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ===== 遮罩层 ===== */

.mobile-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) - 1);
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

/* 遮罩层过渡动画 */
.mobile-menu-overlay-enter-active,
.mobile-menu-overlay-leave-active {
  transition: opacity var(--transition-normal);
}

.mobile-menu-overlay-enter-from,
.mobile-menu-overlay-leave-to {
  opacity: 0;
}

/* ===== 抽屉式菜单 ===== */

.mobile-menu {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: var(--z-modal);
  width: min(320px, 85vw);
  background-color: var(--c-bg);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 主题切换过渡 */
  transition:
    background-color var(--transition-normal),
    box-shadow var(--transition-normal);
}

/* 菜单滑入动画 */
.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: transform var(--transition-normal);
}

.mobile-menu-enter-from,
.mobile-menu-leave-to {
  transform: translateX(-100%);
}

/* ===== 菜单头部 ===== */

.mobile-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--navbar-height);
  padding: 0 var(--spacing-4);
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.mobile-menu-logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  text-decoration: none;
}

.mobile-menu-logo-img {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

.mobile-menu-logo .logo-text {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-lg);
  color: var(--c-text-1);
  letter-spacing: -0.02em;
}

.mobile-menu-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background-color: transparent;
  color: var(--c-text-2);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.mobile-menu-close:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.mobile-menu-close:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

/* ===== 主导航 ===== */

.mobile-menu-nav {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-3) 0;
}

.mobile-nav-link {
  display: flex;
  align-items: center;
  padding: var(--spacing-3) var(--spacing-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--c-text-1);
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.mobile-nav-link:hover {
  background-color: var(--c-hover);
}

.mobile-nav-link:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

/* 导航子菜单 */
.mobile-nav-group {
  display: flex;
  flex-direction: column;
}

.mobile-nav-sub {
  display: flex;
  flex-direction: column;
  padding-left: var(--spacing-4);
}

.mobile-nav-sub-link {
  display: flex;
  align-items: center;
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--c-text-2);
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.mobile-nav-sub-link:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.mobile-nav-sub-link.is-active {
  color: rgba(235, 86, 0, 1);
}

/* ===== 分隔线 ===== */

.mobile-menu-divider {
  height: 1px;
  margin: var(--spacing-2) 0;
  background-color: var(--c-border);
}

/* ===== 侧边栏内容 ===== */

.mobile-menu-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--spacing-4);
  padding-bottom: var(--spacing-12);
}

/* 自定义滚动条 */
.mobile-menu-content::-webkit-scrollbar {
  width: 6px;
}

.mobile-menu-content::-webkit-scrollbar-track {
  background: transparent;
}

.mobile-menu-content::-webkit-scrollbar-thumb {
  background-color: var(--c-border);
  border-radius: 3px;
}

.mobile-menu-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--c-border-dark);
}

/* ===== 侧边栏导航 ===== */

.mobile-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

/* ===== 分组样式 ===== */

.mobile-sidebar-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.mobile-sidebar-group + .mobile-sidebar-group {
  margin-top: var(--spacing-4);
}

.mobile-sidebar-group-title {
  padding: var(--spacing-2) 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mobile-sidebar-group-items {
  display: flex;
  flex-direction: column;
}

/* ===== 加载骨架屏 ===== */

.mobile-sidebar-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  padding: var(--spacing-2) 0;
}

.mobile-sidebar-skeleton .skeleton-item {
  padding: 0 var(--spacing-2);
}

.mobile-sidebar-skeleton .skeleton-line {
  height: 12px;
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--c-border) 25%, var(--c-bg-mute) 50%, var(--c-border) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ===== 空状态 ===== */

.mobile-sidebar-empty {
  padding: var(--spacing-4);
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--font-size-sm);
}
</style>
