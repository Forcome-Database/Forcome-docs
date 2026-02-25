<script setup lang="ts">
/**
 * 顶部导航栏组件
 * 包含 Logo、主导航、搜索按钮、主题切换、语言切换、登录按钮
 * 
 * 需求: 2.1-2.8
 */
import { ref, computed } from 'vue'
import { useData, useRoute } from 'vitepress'
import MenuIcon from './icons/MenuIcon.vue'
import SearchIcon from './icons/SearchIcon.vue'
import ThemeToggle from './ThemeToggle.vue'
import LangSwitch from './LangSwitch.vue'
import { useDocmostSidebar } from '../composables/useDocmostSidebar'

// 定义事件
const emit = defineEmits<{
  (e: 'toggle-sidebar'): void
  (e: 'open-search'): void
  (e: 'toggle-ai-chat'): void
}>()

// 获取 VitePress 数据
const { theme } = useData()
const route = useRoute()
const { spaces: docmostSpaces } = useDocmostSidebar()

// 当前打开的下拉菜单
const openDropdown = ref<string | null>(null)

// 从路由路径中提取当前语言
const currentLang = computed(() => {
  const match = route.path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
})

// 从静态导航中提取已覆盖的空间 slug 集合
function extractStaticSlugs(navItems: any[]): Set<string> {
  const slugs = new Set<string>()
  for (const item of navItems) {
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

// 导航项：静态配置 + 动态发现的空间
const navItems = computed(() => {
  const staticNav = theme.value.nav || []
  const coveredSlugs = extractStaticSlugs(staticNav)
  const lang = currentLang.value

  // 筛选未被静态导航覆盖的空间，生成动态导航项
  const dynamicItems = docmostSpaces.value
    .filter((space) => !coveredSlugs.has(space.slug))
    .map((space) => ({
      text: space.name,
      link: `/${lang}/docs/${space.slug}/`,
      activeMatch: `^/${lang}/docs/${space.slug}`,
    }))

  if (dynamicItems.length === 0) return staticNav

  // 动态项追加到静态项末尾
  return [...staticNav, ...dynamicItems]
})

// 检查导航项是否有子菜单
const hasChildren = (item: any) => {
  return item.items && item.items.length > 0
}

// 切换下拉菜单
const toggleDropdown = (text: string) => {
  openDropdown.value = openDropdown.value === text ? null : text
}

// 关闭下拉菜单
const closeDropdown = () => {
  openDropdown.value = null
}

// 检查链接是否激活（使用 route.path 支持 Docmost 动态路由）
const isActive = (link: string, activeMatch?: string) => {
  const currentPath = route.path

  // 如果有 activeMatch 正则，使用正则匹配
  if (activeMatch) {
    return new RegExp(activeMatch).test(currentPath)
  }

  // 首页特殊处理：只有在根路径时才激活
  if (link === '/' || link === '') {
    return currentPath === '/' || currentPath === ''
  }

  // 其他链接使用前缀匹配
  const normalizedLink = link.replace(/\/$/, '')
  const normalizedPath = currentPath.replace(/\/$/, '')

  return normalizedPath === normalizedLink || normalizedPath.startsWith(normalizedLink + '/')
}

// 检查下拉菜单是否有激活的子项
const isDropdownActive = (item: any) => {
  // 优先使用父级的 activeMatch
  if (item.activeMatch) {
    return isActive('', item.activeMatch)
  }
  // 否则检查子项是否有激活的
  if (item.items) {
    return item.items.some((child: any) => isActive(child.link, child.activeMatch))
  }
  return false
}
</script>

<template>
  <header class="navbar" role="banner">
    <div class="navbar-container">
      <!-- 左侧区域 -->
      <div class="navbar-left">
        <!-- 移动端菜单按钮 -->
        <button
          class="menu-button"
          type="button"
          aria-label="切换侧边栏"
          aria-controls="mobile-menu"
          @click="emit('toggle-sidebar')"
        >
          <MenuIcon :size="20" />
        </button>

        <!-- Logo -->
        <a href="/" class="navbar-logo" aria-label="FORCOME 知识库首页">
          <img src="/images/logo/logo.png" alt="Logo" class="logo-image" />
          <span class="logo-text" aria-hidden="true">FORCOME 知识库</span>
        </a>

        <!-- 主导航（桌面端） -->
        <nav class="navbar-nav" aria-label="主导航">
          <template v-for="item in navItems" :key="item.text">
            <!-- 有子菜单的导航项 -->
            <div
              v-if="hasChildren(item)"
              class="nav-dropdown"
              @mouseenter="openDropdown = item.text"
              @mouseleave="closeDropdown"
            >
              <button
                class="nav-link nav-dropdown-trigger"
                :class="{ 'is-open': openDropdown === item.text, 'is-active': isDropdownActive(item) }"
                type="button"
                @click="toggleDropdown(item.text)"
              >
                {{ item.text }}
                <svg
                  class="nav-dropdown-arrow"
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              <!-- 下拉菜单 -->
              <div
                v-show="openDropdown === item.text"
                class="nav-dropdown-menu"
              >
                <a
                  v-for="child in item.items"
                  :key="child.text"
                  :href="child.link"
                  class="nav-dropdown-item"
                  :class="{ 'is-active': isActive(child.link, child.activeMatch) }"
                  @click="closeDropdown"
                >
                  {{ child.text }}
                </a>
              </div>
            </div>
            <!-- 普通导航项 -->
            <a
              v-else
              :href="item.link"
              class="nav-link"
              :class="{ 'is-active': isActive(item.link, item.activeMatch) }"
              :aria-current="isActive(item.link, item.activeMatch) ? 'page' : undefined"
            >
              {{ item.text }}
            </a>
          </template>
        </nav>
      </div>

      <!-- 右侧区域 -->
      <div class="navbar-right">
        <!-- 搜索按钮 -->
        <button
          class="search-button"
          type="button"
          aria-label="搜索文档 (⌘K)"
          @click="emit('open-search')"
        >
          <SearchIcon :size="16" />
          <span class="search-text" aria-hidden="true">搜索文档...</span>
          <kbd class="search-kbd" aria-hidden="true">⌘K</kbd>
        </button>

        <!-- AI 问答按钮 -->
        <button
          class="ai-button"
          type="button"
          aria-label="IT智能助手 (⌘I)"
          @click="emit('toggle-ai-chat')"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2" 
            stroke-linecap="round" 
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span class="ai-text" aria-hidden="true">问一问康康</span>
          <kbd class="ai-kbd" aria-hidden="true">⌘I</kbd>
        </button>

        <!-- 语言切换 -->
        <LangSwitch />

        <!-- 主题切换 -->
        <ThemeToggle />

        <!-- 登录按钮 -->
        <a href="/login" class="login-button">
          登录
        </a>
      </div>
    </div>
  </header>
</template>

<style scoped>
/* ===== 导航栏容器 ===== */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-navbar);
  height: var(--navbar-height);
  background-color: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
  transition: 
    background-color var(--transition-normal),
    border-color var(--transition-normal);
}

.navbar-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  max-width: 100%;
  padding: 0 var(--spacing-4);
}

/* ===== 左侧区域 ===== */
.navbar-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
}

/* 移动端菜单按钮 */
.menu-button {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: var(--spacing-1);
  border-radius: var(--radius-md);
  color: var(--c-text-2);
  background-color: transparent;
  border: none;
  cursor: pointer;
  transition: 
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.menu-button:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.menu-button:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

/* Logo */
.navbar-logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  text-decoration: none;
}

.logo-image {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.logo-text {
  font-weight: 600;
  font-size: 16px;
  color: rgba(38, 37, 30, 1);
  letter-spacing: -0.02em;
}

:root.dark .logo-text {
  color: rgba(236, 236, 231, 1);
}

/* 主导航 */
.navbar-nav {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: var(--spacing-4);
}

.nav-link {
  padding: 8px 12px;
  border-radius: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  color: rgba(122, 121, 116, 1);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.nav-link:hover {
  color: rgba(38, 37, 30, 1);
}

:root.dark .nav-link {
  color: rgba(156, 155, 150, 1);
}

:root.dark .nav-link:hover {
  color: rgba(236, 236, 231, 1);
}

.nav-link.is-active {
  color: rgba(235, 86, 0, 1);
  font-weight: 400;
  position: relative;
}

/* 激活状态下划线 */
.nav-link.is-active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  background-color: rgba(235, 86, 0, 1);
  border-radius: 1px;
}

/* ===== 下拉菜单 ===== */
.nav-dropdown {
  position: relative;
}

.nav-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
}

.nav-dropdown-arrow {
  color: rgba(122, 121, 116, 1);
  transition: transform 0.15s ease;
}

.nav-dropdown-trigger.is-open .nav-dropdown-arrow {
  transform: rotate(180deg);
}

:root.dark .nav-dropdown-arrow {
  color: rgba(156, 155, 150, 1);
}

.nav-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 160px;
  padding: 8px 0;
  padding-top: 12px;
  background-color: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
}

/* 用伪元素填充间隙，防止鼠标移动时菜单消失 */
.nav-dropdown-menu::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
}

:root.dark .nav-dropdown-menu {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.nav-dropdown-item {
  display: block;
  padding: 8px 16px;
  font-size: 14px;
  line-height: 20px;
  color: rgba(38, 37, 30, 1);
  text-decoration: none;
  transition: background-color 0.15s ease;
}

.nav-dropdown-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.nav-dropdown-item.is-active {
  color: rgba(235, 86, 0, 1);
}

:root.dark .nav-dropdown-item {
  color: rgba(236, 236, 231, 1);
}

:root.dark .nav-dropdown-item:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

/* ===== 右侧区域 ===== */
.navbar-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

/* 搜索按钮 */
.search-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  height: 36px;
  padding: 0 12px 0 12px;
  border-radius: 8px;
  background-color: rgb(247, 247, 244);
  border: none;
  color: rgba(122, 121, 116, 1);
  cursor: pointer;
  font-size: 14px;
  font-weight: 400;
  transition: 
    background-color var(--transition-fast),
    color var(--transition-fast);
}

:root.dark .search-button {
  background-color: rgba(40, 40, 40, 1);
  color: rgba(156, 155, 150, 1);
}

.search-button:hover {
  background-color: rgb(240, 240, 235);
  color: rgba(38, 37, 30, 1);
}

:root.dark .search-button:hover {
  background-color: rgba(50, 50, 50, 1);
  color: rgba(236, 236, 231, 1);
}

.search-button:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.search-text {
  color: inherit;
}

.search-kbd,
.ai-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-family-mono);
  font-size: 12px;
  padding: 2px 6px;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  color: inherit;
  margin-left: var(--spacing-2);
  line-height: 1;
}

:root.dark .search-kbd,
:root.dark .ai-kbd {
  background-color: rgba(255, 255, 255, 0.1);
}

/* AI 按钮 */
.ai-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background-color: transparent;
  border: 1px solid rgba(0, 0, 0, 0.1);
  color: rgba(122, 121, 116, 1);
  cursor: pointer;
  font-size: 14px;
  font-weight: 400;
  transition: 
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

:root.dark .ai-button {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(156, 155, 150, 1);
}

.ai-button:hover {
  background-color: rgba(0, 0, 0, 0.03);
  color: rgba(38, 37, 30, 1);
}

:root.dark .ai-button:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: rgba(236, 236, 231, 1);
}

.ai-button:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.ai-text {
  white-space: nowrap;
}

/* 登录按钮 */
.login-button {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: rgba(38, 37, 30, 1);
  text-decoration: none;
  transition: color var(--transition-fast);
}

:root.dark .login-button {
  color: rgba(236, 236, 231, 1);
}

.login-button:hover {
  color: rgba(122, 121, 116, 1);
}

:root.dark .login-button:hover {
  color: rgba(156, 155, 150, 1);
}

/* ===== 响应式布局 ===== */

/* 平板端 (< 1024px) */
@media (max-width: 1023px) {
  .menu-button {
    display: flex;
  }

  .navbar-nav {
    display: none;
  }
}

/* 小屏幕 (< 640px) */
@media (max-width: 639px) {
  .navbar-container {
    padding: 0 var(--spacing-3);
  }

  .search-text,
  .search-kbd {
    display: none;
  }

  .ai-text,
  .ai-kbd {
    display: none;
  }

  .login-button {
    display: none;
  }
}
</style>
