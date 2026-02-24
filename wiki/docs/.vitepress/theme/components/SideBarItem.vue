<script setup lang="ts">
/**
 * 侧边栏项组件
 * 递归渲染目录项，支持折叠展开和路由高亮
 * 
 * 需求: 3.1-3.7
 */
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vitepress'
import ChevronIcon from './icons/ChevronIcon.vue'
import type { SidebarItem } from '../types'

const props = defineProps<{
  /** 侧边栏项数据 */
  item: SidebarItem
  /** 嵌套层级（用于缩进） */
  depth?: number
}>()

const emit = defineEmits<{
  /** 点击链接时触发 */
  (e: 'navigate'): void
}>()

const route = useRoute()

// 当前嵌套深度
const currentDepth = computed(() => props.depth ?? 0)

// 是否有子项
const hasChildren = computed(() => {
  return props.item.items && props.item.items.length > 0
})

// 折叠状态（默认根据 collapsed 属性或展开）
const isCollapsed = ref(props.item.collapsed ?? false)

// 当前项是否激活（路由匹配）
const isActive = computed(() => {
  if (!props.item.link) return false
  const currentPath = route.path
  const itemPath = props.item.link
  
  // 精确匹配或前缀匹配（处理尾部斜杠）
  const normalizedCurrent = currentPath.replace(/\/$/, '') || '/'
  const normalizedItem = itemPath.replace(/\/$/, '') || '/'
  
  return normalizedCurrent === normalizedItem
})

// 子项中是否有激活项（用于自动展开）
const hasActiveChild = computed(() => {
  if (!hasChildren.value) return false
  
  const checkActive = (items: SidebarItem[]): boolean => {
    for (const child of items) {
      if (child.link) {
        const normalizedCurrent = route.path.replace(/\/$/, '') || '/'
        const normalizedItem = child.link.replace(/\/$/, '') || '/'
        if (normalizedCurrent === normalizedItem) return true
      }
      if (child.items && checkActive(child.items)) return true
    }
    return false
  }
  
  return checkActive(props.item.items!)
})

// 监听路由变化，自动展开包含激活项的父级
watch(
  () => route.path,
  () => {
    if (hasActiveChild.value && isCollapsed.value) {
      isCollapsed.value = false
    }
  },
  { immediate: true }
)

/**
 * 切换折叠状态
 */
const toggleCollapse = () => {
  if (hasChildren.value) {
    isCollapsed.value = !isCollapsed.value
  }
}

/**
 * 处理链接点击
 */
const handleClick = () => {
  emit('navigate')
}

/**
 * 计算缩进样式
 */
const indentStyle = computed(() => ({
  paddingLeft: `${8 + currentDepth.value * 12}px`
}))
</script>

<template>
  <div class="sidebar-item" :class="{ 'has-children': hasChildren }">
    <!-- 可折叠的分组标题 -->
    <button
      v-if="hasChildren && !item.link"
      class="sidebar-item-button sidebar-group-toggle"
      :class="{ 'is-collapsed': isCollapsed }"
      :style="indentStyle"
      type="button"
      @click="toggleCollapse"
      :aria-expanded="!isCollapsed"
      :aria-controls="`sidebar-children-${item.text}`"
    >
      <span class="sidebar-item-text">{{ item.text }}</span>
      <ChevronIcon
        class="sidebar-chevron"
        :direction="isCollapsed ? 'right' : 'down'"
        :size="14"
      />
    </button>

    <!-- 带链接的可折叠项 -->
    <div
      v-else-if="hasChildren && item.link"
      class="sidebar-item-with-link"
    >
      <a
        :href="item.link"
        class="sidebar-link"
        :class="{ 'is-active': isActive }"
        :style="indentStyle"
        :aria-current="isActive ? 'page' : undefined"
        @click="handleClick"
      >
        <span class="sidebar-item-text">{{ item.text }}</span>
      </a>
      <button
        class="sidebar-collapse-btn"
        :class="{ 'is-collapsed': isCollapsed }"
        type="button"
        @click="toggleCollapse"
        :aria-expanded="!isCollapsed"
        :aria-label="isCollapsed ? `展开 ${item.text}` : `折叠 ${item.text}`"
        :aria-controls="`sidebar-children-${item.text}`"
      >
        <ChevronIcon
          class="sidebar-chevron"
          :direction="isCollapsed ? 'right' : 'down'"
          :size="14"
        />
      </button>
    </div>

    <!-- 普通链接项 -->
    <a
      v-else
      :href="item.link"
      class="sidebar-link"
      :class="{ 'is-active': isActive }"
      :style="indentStyle"
      :aria-current="isActive ? 'page' : undefined"
      @click="handleClick"
    >
      <span class="sidebar-item-text">{{ item.text }}</span>
    </a>

    <!-- 子项列表 -->
    <div
      v-if="hasChildren && !isCollapsed"
      :id="`sidebar-children-${item.text}`"
      class="sidebar-children"
      role="group"
      :aria-label="`${item.text} 子菜单`"
    >
      <SideBarItem
        v-for="(child, index) in item.items"
        :key="child.link || index"
        :item="child"
        :depth="currentDepth + 1"
        @navigate="emit('navigate')"
      />
    </div>
  </div>
</template>

<style scoped>
/* ===== 侧边栏项基础样式 ===== */

.sidebar-item {
  display: flex;
  flex-direction: column;
}

/* ===== 按钮和链接通用样式 ===== */

.sidebar-item-button,
.sidebar-link {
  display: flex;
  align-items: center;
  width: calc(100% + 16px);
  margin-left: -8px;
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 16px;
  line-height: 26px;
  font-weight: 400;
  font-family: inherit;
  color: rgba(38, 37, 30, 1);
  text-decoration: none;
  text-align: left;
  cursor: pointer;
  height: 35px;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.sidebar-item-button:hover,
.sidebar-link:hover {
  background-color: rgba(0, 0, 0, 0.04);
  color: rgba(38, 37, 30, 1);
}

:root.dark .sidebar-item-button,
:root.dark .sidebar-link {
  color: rgba(236, 236, 231, 1);
}

:root.dark .sidebar-item-button:hover,
:root.dark .sidebar-link:hover {
  background-color: rgba(255, 255, 255, 0.06);
  color: rgba(236, 236, 231, 1);
}

/* 焦点样式（可访问性） */
.sidebar-item-button:focus-visible,
.sidebar-link:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

/* ===== 分组标题样式 ===== */

.sidebar-group-toggle {
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  color: rgba(38, 37, 30, 1);
  justify-content: space-between;
}

.sidebar-group-toggle:hover {
  background-color: rgba(0, 0, 0, 0.04);
  color: rgba(38, 37, 30, 1);
}

:root.dark .sidebar-group-toggle {
  color: rgba(236, 236, 231, 1);
}

:root.dark .sidebar-group-toggle:hover {
  background-color: rgba(255, 255, 255, 0.06);
  color: rgba(236, 236, 231, 1);
}

/* ===== 激活状态 ===== */

.sidebar-link.is-active {
  background-color: transparent;
  color: rgba(235, 86, 0, 1);
  font-weight: 400;
  position: relative;
}

.sidebar-link.is-active:hover {
  background-color: transparent;
}

/* ===== 带链接的可折叠项 ===== */

.sidebar-item-with-link {
  display: flex;
  align-items: center;
}

.sidebar-item-with-link .sidebar-link {
  flex: 1;
  padding-right: 0;
}

.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.sidebar-collapse-btn:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.sidebar-collapse-btn:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

/* ===== 箭头图标 ===== */

.sidebar-chevron {
  flex-shrink: 0;
  color: var(--c-text-3);
  transition: transform var(--transition-fast);
}

/* ===== 文本样式 ===== */

.sidebar-item-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 子项容器 ===== */

.sidebar-children {
  display: flex;
  flex-direction: column;
  position: relative;
  margin-left: 1px;
  padding-left: 12px;
  border-left: 1px solid rgb(226, 226, 223);
}

:root.dark .sidebar-children {
  border-left-color: rgb(60, 60, 60);
}

/* 子项内的链接样式调整 */
.sidebar-children .sidebar-link,
.sidebar-children .sidebar-item-button {
  width: calc(100% + 16px);
  margin-left: -8px;
}

/* 子项内激活状态的橙色竖线 - 覆盖灰色竖线 */
.sidebar-children .sidebar-link.is-active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background-color: rgba(235, 86, 0, 1);
  border-radius: 1px;
}
</style>
