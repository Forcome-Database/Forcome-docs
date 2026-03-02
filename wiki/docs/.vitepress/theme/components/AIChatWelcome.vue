<script setup lang="ts">
/**
 * AI 问答欢迎页组件
 * 显示欢迎信息、服务状态提示和推荐问题
 */

const props = defineProps<{
  modifierKey: string
  isConfigured: boolean
  pageTitle?: string
}>()

const emit = defineEmits<{
  (e: 'ask', question: string): void
}>()

const suggestions = [
  '这个页面讲了什么？',
  '帮我总结要点',
  '有什么相关的文档？',
]
</script>

<template>
  <div class="ai-chat-welcome">
    <img src="/images/logo/logo.png" alt="Logo" class="welcome-logo" />
    <h3 class="welcome-title">你好！我是 IT智能助手</h3>
    <p class="welcome-text">我可以回答关于文档的问题，帮助你快速找到所需信息。</p>
    <p v-if="!isConfigured" class="welcome-hint">⚠️ AI 服务未配置，请检查环境变量</p>
    <div class="welcome-shortcuts">
      <kbd>{{ modifierKey }}I</kbd>
      <span>打开/关闭面板</span>
    </div>
    <!-- 推荐问题 -->
    <div v-if="isConfigured" class="ai-chat-suggestions">
      <button
        v-for="(q, i) in suggestions"
        :key="i"
        class="ai-chat-suggestion-btn"
        @click="emit('ask', q)"
      >
        {{ q }}
      </button>
    </div>
  </div>
</template>
