<script setup lang="ts">
/**
 * 菜单图标组件
 * 用于移动端侧边栏切换按钮
 * 
 * 可访问性：装饰性图标，使用 aria-hidden 隐藏
 */
defineProps<{
  size?: number
}>()
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size ?? 20"
    :height="size ?? 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="icon icon-menu"
    aria-hidden="true"
    focusable="false"
  >
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
</template>
