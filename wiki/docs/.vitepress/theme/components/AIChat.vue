<script setup lang="ts">
/**
 * AI 问答面板组件
 * 使用 ant-design-x-vue 重构，支持流式响应和 Markdown 渲染
 * 
 * 需求: 6.1-6.12, 8.5
 */
import { ref, watch, onMounted, onUnmounted, nextTick, computed, h } from 'vue'
import { Bubble, Sender, XProvider } from 'ant-design-x-vue'
import { theme } from 'ant-design-vue'
import { getAIChatModifierKey, getDifyMode, getDifyEmbedUrl, isEmbedConfigured } from '../composables/useAIChat'
import { useTheme } from '../composables/useTheme'
import { createDifyService } from '../services/dify'
import { storage } from '../services/storage'
import type { ChatMessage, StoredChatHistory } from '../types'
import { StorageKey } from '../types'
import CloseIcon from './icons/CloseIcon.vue'
import TrashIcon from './icons/TrashIcon.vue'

// 获取主题状态
const { isDark } = useTheme()

// 计算 ant-design-x-vue 主题配置
const antTheme = computed(() => ({
  algorithm: isDark.value ? theme.darkAlgorithm : theme.defaultAlgorithm
}))

// 定义事件
const emit = defineEmits<{
  (e: 'close'): void
}>()

// 获取当前模式
const difyMode = getDifyMode()
const embedUrl = getDifyEmbedUrl()
const embedConfigured = isEmbedConfigured()

// 计算是否使用嵌入模式
const isEmbedMode = computed(() => difyMode === 'embed')

// 获取快捷键修饰符
const modifierKey = getAIChatModifierKey()

// ===== 状态管理 =====
const messages = ref<ChatMessage[]>([])
const conversationId = ref<string | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
const inputText = ref('')

// Dify 服务
let difyService = createDifyService()
const isConfigured = computed(() => difyService?.isConfigured() ?? false)
const hasMessages = computed(() => messages.value.length > 0)
const canSend = computed(() => inputText.value.trim().length > 0 && !isLoading.value)

// ===== Markdown 渲染 =====
const renderMarkdown = (content: string) => {
  if (!content) return h('span')
  
  let html = content
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 代码块
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    // 链接
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // 粗体
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // 换行
    .replace(/\n/g, '<br>')
  
  return h('div', { 
    class: 'markdown-content',
    innerHTML: html 
  })
}

// ===== Bubble.List 数据转换 =====
const bubbleItems = computed(() => {
  return messages.value.map(msg => ({
    key: msg.id,
    role: msg.role,
    content: msg.content,
    loading: msg.isStreaming && !msg.content,
    typing: msg.isStreaming ? { step: 2, interval: 50 } : undefined,
    messageRender: msg.role === 'assistant' ? renderMarkdown : undefined
  }))
})

// Bubble 角色配置
const roles = {
  user: {
    placement: 'end' as const,
    variant: 'filled' as const,
    shape: 'round' as const,
    avatar: { style: { display: 'none' } }
  },
  assistant: {
    placement: 'start' as const,
    variant: 'outlined' as const,
    avatar: { style: { display: 'none' } }
  }
}

// ===== 生成消息 ID =====
function generateMessageId(role: 'user' | 'assistant'): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ===== 历史记录管理 =====
const loadHistory = () => {
  const history = storage.get<StoredChatHistory>(StorageKey.ChatHistory)
  if (history) {
    messages.value = history.messages
    conversationId.value = history.conversationId || null
  }
}

const saveHistory = () => {
  const history: StoredChatHistory = {
    conversationId: conversationId.value || '',
    messages: messages.value.filter(m => !m.isStreaming),
    updatedAt: Date.now()
  }
  storage.set(StorageKey.ChatHistory, history)
}


// ===== 发送消息 =====
const sendMessage = async (content: string) => {
  const messageContent = content.trim()
  if (!messageContent) return
  
  if (!difyService) {
    error.value = 'AI 服务未配置，请检查环境变量'
    return
  }

  inputText.value = ''
  error.value = null

  // 添加用户消息
  const userMessage: ChatMessage = {
    id: generateMessageId('user'),
    role: 'user',
    content: messageContent,
    timestamp: Date.now()
  }
  messages.value.push(userMessage)

  // 创建助手消息占位符
  const assistantMessage: ChatMessage = {
    id: generateMessageId('assistant'),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  }
  messages.value.push(assistantMessage)

  isLoading.value = true

  try {
    // 获取助手消息在数组中的索引
    const assistantIndex = messages.value.length - 1
    
    for await (const event of difyService.sendMessage(
      messageContent,
      conversationId.value || undefined
    )) {
      if ((event.event === 'message' || event.event === 'agent_message') && event.answer) {
        // 通过替换整个对象来触发响应式更新
        const currentMsg = messages.value[assistantIndex]
        messages.value[assistantIndex] = {
          ...currentMsg,
          content: currentMsg.content + event.answer
        }
      } else if (event.event === 'message_end') {
        // 更新流式状态
        const currentMsg = messages.value[assistantIndex]
        messages.value[assistantIndex] = {
          ...currentMsg,
          isStreaming: false
        }
        if (event.conversation_id) {
          conversationId.value = event.conversation_id
        }
      } else if (event.event === 'error') {
        throw new Error('AI 服务返回错误')
      }
    }
    saveHistory()
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : '发送失败，请重试'
    error.value = errorMessage
    
    // 移除失败的助手消息（最后一条）
    if (messages.value.length > 0 && messages.value[messages.value.length - 1].role === 'assistant') {
      messages.value.pop()
    }
    console.error('[AIChat] 发送消息失败:', e)
  } finally {
    isLoading.value = false
  }
}

// ===== 操作方法 =====
const handleSubmit = (value: string) => {
  sendMessage(value)
}

const handleClearHistory = () => {
  if (confirm('确定要清空所有对话历史吗？')) {
    messages.value = []
    conversationId.value = null
    error.value = null
    storage.remove(StorageKey.ChatHistory)
  }
}

const handleClose = () => {
  emit('close')
}

const retry = () => {
  const lastUserMessage = [...messages.value].reverse().find(m => m.role === 'user')
  if (lastUserMessage) {
    const index = messages.value.findIndex(m => m.id === lastUserMessage.id)
    if (index !== -1) {
      messages.value.splice(index)
    }
    sendMessage(lastUserMessage.content)
  }
}

const abort = () => {
  difyService?.abort()
  isLoading.value = false
  const streamingIndex = messages.value.findIndex(m => m.isStreaming)
  if (streamingIndex !== -1) {
    messages.value.splice(streamingIndex, 1)
  }
}

// ===== 键盘事件 =====
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    handleClose()
  }
}

// ===== 生命周期 =====
onMounted(() => {
  loadHistory()
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  abort()
  document.removeEventListener('keydown', handleKeydown)
})
</script>


<template>
  <div class="ai-chat-root">
    <Teleport to="body">
      <!-- 遮罩层 -->
      <div class="ai-chat-overlay" @click="handleClose" />

    <!-- AI 问答面板 -->
    <aside 
      class="ai-chat-panel" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="ai-chat-title"
    >
      <!-- 头部 -->
      <header class="ai-chat-header">
        <div class="ai-chat-title-wrapper">
          <img src="/images/logo/logo.png" alt="Logo" class="ai-chat-logo" />
          <h2 class="ai-chat-title" id="ai-chat-title">IT智能助手</h2>
        </div>
        <div class="ai-chat-actions">
          <button 
            v-if="!isEmbedMode"
            class="ai-chat-action-btn"
            type="button"
            :disabled="!hasMessages"
            aria-label="清空历史"
            @click="handleClearHistory"
          >
            <TrashIcon :size="16" />
          </button>
          <button 
            class="ai-chat-action-btn"
            type="button"
            aria-label="关闭 IT智能助手 (ESC)"
            @click="handleClose"
          >
            <CloseIcon :size="16" />
          </button>
        </div>
      </header>

      <!-- 嵌入模式：iframe -->
      <template v-if="isEmbedMode">
        <div class="ai-chat-embed">
          <iframe
            v-if="embedConfigured"
            :src="embedUrl"
            class="ai-chat-iframe"
            frameborder="0"
            allow="microphone"
            title="AI 助手"
          />
          <div v-else class="ai-chat-embed-error">
            <div class="welcome-icon">⚠️</div>
            <p class="welcome-text">嵌入模式未配置</p>
          </div>
        </div>
      </template>

      <!-- API 模式：对话界面 -->
      <template v-else>
        <XProvider :theme="antTheme">
          <!-- 消息列表 -->
          <div class="ai-chat-messages">
            <!-- 欢迎信息 -->
            <div v-if="!hasMessages" class="ai-chat-welcome">
              <img src="/images/logo/logo.png" alt="Logo" class="welcome-logo" />
              <h3 class="welcome-title">你好！我是 IT智能助手</h3>
              <p class="welcome-text">我可以回答关于文档的问题，帮助你快速找到所需信息。</p>
              <p v-if="!isConfigured" class="welcome-hint">⚠️ AI 服务未配置，请检查环境变量</p>
              <div class="welcome-shortcuts">
                <kbd>{{ modifierKey }}I</kbd>
                <span>打开/关闭面板</span>
              </div>
            </div>

            <!-- Bubble.List 消息列表 -->
            <Bubble.List
              v-else
              :items="bubbleItems"
              :roles="roles"
              class="bubble-list"
            />

            <!-- 错误提示 -->
            <div v-if="error" class="ai-chat-error">
              <p class="error-message">{{ error }}</p>
              <button class="error-retry-btn" @click="retry">重试</button>
            </div>
          </div>

          <!-- 输入区域 -->
          <footer class="ai-chat-footer">
            <Sender
              v-model:value="inputText"
              placeholder="输入你的问题..."
              :loading="isLoading"
              submit-type="enter"
              class="ai-chat-sender"
              @submit="handleSubmit"
              @cancel="abort"
            />
            <p class="ai-chat-input-hint">
              <kbd>Enter</kbd> 发送 · <kbd>Shift+Enter</kbd> 换行 · <kbd>ESC</kbd> 关闭
            </p>
          </footer>
        </XProvider>
      </template>
    </aside>
    </Teleport>
  </div>
</template>


<style scoped>
/* 遮罩层 */
.ai-chat-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) - 1);
  background-color: rgba(0, 0, 0, 0.3);
}

/* AI 面板 */
.ai-chat-panel {
  position: fixed;
  top: var(--navbar-height);
  right: 0;
  bottom: 0;
  z-index: var(--z-modal);
  width: var(--ai-panel-width);
  background-color: var(--c-bg);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  transition: background-color var(--transition-normal), border-color var(--transition-normal);
}

/* 头部 */
.ai-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-3) var(--spacing-4);
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.ai-chat-title-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.ai-chat-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.ai-chat-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--c-text-1);
  margin: 0;
}

.ai-chat-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
}

.ai-chat-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background-color: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.ai-chat-action-btn:hover:not(:disabled) {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.ai-chat-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 消息列表 */
.ai-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-4);
}

/* Bubble.List 样式覆盖 */
.bubble-list {
  height: 100%;
}

:deep(.ant-bubble) {
  max-width: 85%;
}

:deep(.ant-bubble-content) {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

/* Markdown 内容样式 */
:deep(.markdown-content) {
  word-break: break-word;
}

:deep(.markdown-content .code-block) {
  display: block;
  margin: 8px 0;
  padding: 12px;
  background-color: var(--c-bg-alt);
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

:deep(.markdown-content .inline-code) {
  padding: 2px 6px;
  background-color: var(--c-bg-alt);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

:deep(.markdown-content a) {
  color: var(--c-accent);
  text-decoration: none;
}

:deep(.markdown-content a:hover) {
  text-decoration: underline;
}

:deep(.markdown-content strong) {
  font-weight: 600;
}

:deep(.markdown-content em) {
  font-style: italic;
}

/* 欢迎信息 */
.ai-chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--spacing-8) var(--spacing-4);
  height: 100%;
}

.welcome-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
  margin-bottom: var(--spacing-4);
}

.welcome-icon {
  font-size: 48px;
  margin-bottom: var(--spacing-4);
}

.welcome-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--c-text-1);
  margin: 0 0 var(--spacing-2);
}

.welcome-text {
  font-size: var(--font-size-sm);
  color: var(--c-text-3);
  margin: 0 0 var(--spacing-4);
  max-width: 280px;
  line-height: var(--line-height-relaxed);
}

.welcome-hint {
  font-size: var(--font-size-sm);
  color: var(--c-warning);
  margin: 0 0 var(--spacing-4);
}

.welcome-shortcuts {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--c-text-4);
}

.welcome-shortcuts kbd {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  background-color: var(--c-bg-mute);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}

/* 错误提示 */
.ai-chat-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-3);
  padding: var(--spacing-3) var(--spacing-4);
  margin: var(--spacing-3) 0;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-md);
}

.error-message {
  font-size: var(--font-size-sm);
  color: var(--c-error);
  margin: 0;
}

.error-retry-btn {
  flex-shrink: 0;
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--c-error);
  background-color: transparent;
  border: 1px solid var(--c-error);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.error-retry-btn:hover {
  background-color: var(--c-error);
  color: white;
}

/* 输入区域 */
.ai-chat-footer {
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

/* Sender 样式覆盖 */
.ai-chat-sender {
  width: 100%;
}

:deep(.ant-sender) {
  border-radius: var(--radius-lg);
  border-color: var(--c-border);
  background-color: var(--c-bg-soft);
}

:deep(.ant-sender:focus-within) {
  border-color: var(--c-accent);
}

:deep(.ant-sender-content) {
  font-size: var(--font-size-sm);
}

.ai-chat-input-hint {
  margin: var(--spacing-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--c-text-4);
  text-align: center;
}

.ai-chat-input-hint kbd {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  background-color: var(--c-bg-mute);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}

/* 嵌入模式 */
.ai-chat-embed {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-chat-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background-color: var(--c-bg);
}

.ai-chat-embed-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--spacing-8) var(--spacing-4);
  height: 100%;
}

/* 移动端适配 */
@media (max-width: 639px) {
  .ai-chat-panel {
    width: 100%;
    top: 0;
  }
  
  .ai-chat-header {
    padding-top: var(--spacing-4);
  }
}
</style>
