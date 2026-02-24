<script setup lang="ts">
/**
 * 搜索图标组件
 * 用于搜索按钮和搜索框
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
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="icon icon-search"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
</template>
