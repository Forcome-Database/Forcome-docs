<script setup lang="ts">
/**
 * 主题切换按钮组件
 * 支持浅色/深色/系统三种模式
 * 
 * 需求: 7.1-7.7
 */
import { useTheme } from '../composables/useTheme'
import SunIcon from './icons/SunIcon.vue'
import MoonIcon from './icons/MoonIcon.vue'

const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <button
    class="theme-toggle"
    :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
    :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
    @click="toggleTheme"
  >
    <!-- 深色模式下显示太阳图标 -->
    <SunIcon v-if="isDark" :size="18" class="theme-icon" />
    <!-- 浅色模式下显示月亮图标 -->
    <MoonIcon v-else :size="18" class="theme-icon" />
  </button>
</template>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: var(--spacing-2);
  border-radius: var(--radius-md);
  color: var(--c-text-2);
  background-color: transparent;
  border: none;
  cursor: pointer;
  transition: 
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.theme-toggle:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.theme-toggle:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.theme-icon {
  flex-shrink: 0;
}
</style>
