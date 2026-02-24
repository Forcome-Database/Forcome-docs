<script setup lang="ts">
/**
 * AI 聊天消息组件
 * 显示用户/AI 消息，支持 Markdown 渲染
 * 
 * 需求: 6.5 - Markdown 渲染
 */
import { computed } from 'vue'
import type { ChatMessage } from '../types'

const props = defineProps<{
  /** 消息对象 */
  message: ChatMessage
}>()

/**
 * 是否为用户消息
 */
const isUser = computed(() => props.message.role === 'user')

/**
 * 格式化时间
 */
const formattedTime = computed(() => {
  const date = new Date(props.message.timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
})

/**
 * 简单的 Markdown 渲染
 * 支持：代码块、行内代码、链接、粗体、斜体、列表
 */
const renderedContent = computed(() => {
  let content = props.message.content
  
  // 转义 HTML 特殊字符（防止 XSS）
  content = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // 代码块 ```code```
  content = content.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    '<pre class="code-block"><code class="language-$1">$2</code></pre>'
  )
  
  // 行内代码 `code`
  content = content.replace(
    /`([^`]+)`/g,
    '<code class="inline-code">$1</code>'
  )
  
  // 链接 [text](url)
  content = content.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="message-link">$1</a>'
  )
  
  // 粗体 **text**
  content = content.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong>$1</strong>'
  )
  
  // 斜体 *text*
  content = content.replace(
    /\*([^*]+)\*/g,
    '<em>$1</em>'
  )
  
  // 无序列表 - item
  content = content.replace(
    /^- (.+)$/gm,
    '<li class="list-item">$1</li>'
  )
  content = content.replace(
    /(<li class="list-item">.*<\/li>\n?)+/g,
    '<ul class="message-list">$&</ul>'
  )
  
  // 有序列表 1. item
  content = content.replace(
    /^\d+\. (.+)$/gm,
    '<li class="list-item-ordered">$1</li>'
  )
  content = content.replace(
    /(<li class="list-item-ordered">.*<\/li>\n?)+/g,
    '<ol class="message-list-ordered">$&</ol>'
  )
  
  // 换行
  content = content.replace(/\n/g, '<br>')
  
  return content
})
</script>

<template>
  <div 
    class="ai-chat-message"
    :class="{ 
      'is-user': isUser, 
      'is-assistant': !isUser,
      'is-streaming': message.isStreaming 
    }"
    role="article"
    :aria-label="`${isUser ? '你' : 'AI 助手'}的消息`"
  >
    <!-- 消息头部 -->
    <div class="message-header">
      <span class="message-role">{{ isUser ? '你' : 'AI 助手' }}</span>
      <time class="message-time" :datetime="new Date(message.timestamp).toISOString()">{{ formattedTime }}</time>
    </div>
    
    <!-- 消息内容 -->
    <div 
      class="message-content"
      v-html="renderedContent"
    />
    
    <!-- 流式输出指示器 -->
    <span v-if="message.isStreaming" class="streaming-indicator" aria-label="正在输入">
      <span class="dot" aria-hidden="true"></span>
      <span class="dot" aria-hidden="true"></span>
      <span class="dot" aria-hidden="true"></span>
    </span>
  </div>
</template>

<style scoped>
.ai-chat-message {
  padding: var(--spacing-4);
  border-radius: var(--radius-lg);
  margin-bottom: var(--spacing-3);
}

/* 用户消息样式 */
.ai-chat-message.is-user {
  background-color: var(--c-bg-soft);
  margin-left: var(--spacing-6);
}

/* AI 消息样式 */
.ai-chat-message.is-assistant {
  background-color: var(--c-bg-mute);
  margin-right: var(--spacing-6);
}

/* 消息头部 */
.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-2);
}

.message-role {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--c-text-2);
}

.message-time {
  font-size: var(--font-size-xs);
  color: var(--c-text-4);
}

/* 消息内容 */
.message-content {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  color: var(--c-text-1);
  word-break: break-word;
}

/* Markdown 样式 */
.message-content :deep(.code-block) {
  display: block;
  margin: var(--spacing-2) 0;
  padding: var(--spacing-3);
  background-color: var(--c-bg-alt);
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.message-content :deep(.inline-code) {
  padding: 2px 6px;
  background-color: var(--c-bg-alt);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.message-content :deep(.message-link) {
  color: var(--c-accent);
  text-decoration: none;
}

.message-content :deep(.message-link:hover) {
  text-decoration: underline;
}

.message-content :deep(.message-list),
.message-content :deep(.message-list-ordered) {
  margin: var(--spacing-2) 0;
  padding-left: var(--spacing-5);
}

.message-content :deep(.list-item),
.message-content :deep(.list-item-ordered) {
  margin-bottom: var(--spacing-1);
}

/* 流式输出指示器 */
.streaming-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: var(--spacing-2);
  vertical-align: middle;
}

.streaming-indicator .dot {
  width: 4px;
  height: 4px;
  background-color: var(--c-text-3);
  border-radius: 50%;
  animation: streaming-dot 1.4s infinite ease-in-out both;
}

.streaming-indicator .dot:nth-child(1) {
  animation-delay: -0.32s;
}

.streaming-indicator .dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes streaming-dot {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
