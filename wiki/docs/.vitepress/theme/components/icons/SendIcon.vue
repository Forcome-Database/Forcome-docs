<script setup lang="ts">
/**
 * 发送图标组件
 * 用于 AI 问答面板的发送按钮
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
    class="icon icon-send"
    aria-hidden="true"
    focusable="false"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
</template>
