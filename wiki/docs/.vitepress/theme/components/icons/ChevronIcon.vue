<script setup lang="ts">
/**
 * 箭头图标组件
 * 用于侧边栏折叠/展开指示器
 * 支持四个方向：up, down, left, right
 * 
 * 可访问性：装饰性图标，使用 aria-hidden 隐藏
 */
defineProps<{
  size?: number
  direction?: 'up' | 'down' | 'left' | 'right'
}>()
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="icon icon-chevron"
    :class="`icon-chevron--${direction ?? 'down'}`"
    aria-hidden="true"
    focusable="false"
  >
    <polyline
      v-if="direction === 'up'"
      points="18 15 12 9 6 15"
    />
    <polyline
      v-else-if="direction === 'left'"
      points="15 18 9 12 15 6"
    />
    <polyline
      v-else-if="direction === 'right'"
      points="9 18 15 12 9 6"
    />
    <polyline
      v-else
      points="6 9 12 15 18 9"
    />
  </svg>
</template>
