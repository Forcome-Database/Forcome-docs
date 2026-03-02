<script setup lang="ts">
/**
 * AI 问答面板组件
 * 支持多轮对话、来源引用卡片、推荐问题、流式 Markdown 渲染
 */
import '../styles/ai-chat.css'
import { ref, watch, onMounted, onUnmounted, computed, h } from 'vue'
import { Bubble, Sender, XProvider } from 'ant-design-x-vue'
import { theme } from 'ant-design-vue'
import { getAIChatModifierKey, getDifyMode, getDifyEmbedUrl, isEmbedConfigured } from '../composables/useAIChat'
import { useTheme } from '../composables/useTheme'
import { useCodeCopy } from '../composables/useCodeCopy'
import { useRoute } from 'vitepress'
import { createDifyService } from '../services/dify'
import { createDocmostService } from '../services/docmost'
import { storage } from '../services/storage'
import { renderMarkdownToHtml } from '../utils/markdown'
import type { ChatMessage, StoredChatHistory, AiSource, AiHistoryMessage } from '../types'
import { StorageKey } from '../types'
import AIChatSources from './AIChatSources.vue'
import AIChatWelcome from './AIChatWelcome.vue'
import CloseIcon from './icons/CloseIcon.vue'
import TrashIcon from './icons/TrashIcon.vue'

// 多轮对话：发送给后端的最大历史消息条数
const MAX_HISTORY_MESSAGES = 10

// 主题
const { isDark } = useTheme()

// 消息列表容器 ref（用于代码复制事件委托）
const messagesContainerRef = ref<HTMLElement | null>(null)
useCodeCopy(messagesContainerRef)

// ant-design-x-vue 主题配置
const antTheme = computed(() => ({
  algorithm: isDark.value ? theme.darkAlgorithm : theme.defaultAlgorithm
}))

// 事件
const emit = defineEmits<{
  (e: 'close'): void
}>()

// Dify 模式检测
const difyMode = getDifyMode()
const embedUrl = getDifyEmbedUrl()
const embedConfigured = isEmbedConfigured()
const isEmbedMode = computed(() => difyMode === 'embed')
const modifierKey = getAIChatModifierKey()

// ===== 状态 =====
const messages = ref<ChatMessage[]>([])
const conversationId = ref<string | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
const inputText = ref('')

// 服务实例
let difyService = createDifyService()
const docmostService = createDocmostService()
const isConfigured = computed(() => {
  if (docmostService) return true
  return difyService?.isConfigured() ?? false
})
const hasMessages = computed(() => messages.value.length > 0)

// ===== 路由 =====
const route = useRoute()

const getChatStorageKey = (): string => {
  return `${StorageKey.ChatHistory}:${route.path}`
}

const getCurrentPageSlugId = (): string | undefined => {
  const match = route.path.match(/^\/(zh|en|vi)\/docs\/[^/]+\/([^/]+)/)
  return match ? match[2] : undefined
}

// ===== Markdown 渲染（含来源卡片） =====
const renderAssistantMessage = (content: string, sources?: AiSource[]) => {
  const nodes: any[] = [
    h('div', {
      class: 'ai-chat-markdown',
      innerHTML: renderMarkdownToHtml(content)
    })
  ]
  if (sources && sources.length > 0) {
    nodes.push(h(AIChatSources, { sources }))
  }
  return h('div', nodes)
}

// ===== Bubble.List 数据转换 =====
const bubbleItems = computed(() => {
  return messages.value.map(msg => ({
    key: msg.id,
    role: msg.role,
    content: msg.content,
    loading: msg.isStreaming && !msg.content,
    typing: msg.isStreaming ? { step: 2, interval: 50 } : undefined,
    messageRender: msg.role === 'assistant'
      ? (content: string) => renderAssistantMessage(content, msg.sources)
      : undefined,
    classNames: msg.isStreaming && msg.role === 'assistant'
      ? { content: 'is-streaming' }
      : undefined
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
    variant: 'borderless' as const,
    avatar: {
      src: '/images/logo/logo.png',
      style: { width: '28px', height: '28px', borderRadius: '50%', flexShrink: '0' }
    }
  }
}

// ===== 工具函数 =====
function generateMessageId(role: 'user' | 'assistant'): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 构建多轮对话历史（最近 N 条已完成消息） */
function buildHistory(): AiHistoryMessage[] {
  const completed = messages.value.filter(m => !m.isStreaming)
  const recent = completed.slice(-MAX_HISTORY_MESSAGES)
  return recent.map(m => ({ role: m.role, content: m.content }))
}

// ===== 历史记录（按页面隔离） =====
const loadHistory = () => {
  const key = getChatStorageKey()
  const saved = storage.get<StoredChatHistory>(key)
  if (saved) {
    messages.value = saved.messages
    conversationId.value = saved.conversationId || null
  } else {
    messages.value = []
    conversationId.value = null
  }
  error.value = null
}

const saveHistory = () => {
  const key = getChatStorageKey()
  const data: StoredChatHistory = {
    conversationId: conversationId.value || '',
    messages: messages.value.filter(m => !m.isStreaming),
    updatedAt: Date.now()
  }
  storage.set(key, data)
}

// ===== 发送消息（支持多轮对话 + 来源卡片） =====
const sendMessage = async (content: string) => {
  const messageContent = content.trim()
  if (!messageContent) return

  if (!docmostService && !difyService) {
    error.value = 'AI 服务未配置，请检查环境变量'
    return
  }

  // 构建历史（在添加新消息之前）
  const history = buildHistory()

  inputText.value = ''
  error.value = null

  // 添加用户消息
  messages.value.push({
    id: generateMessageId('user'),
    role: 'user',
    content: messageContent,
    timestamp: Date.now()
  })

  // 创建助手消息占位符
  const assistantIndex = messages.value.length
  messages.value.push({
    id: generateMessageId('assistant'),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  })

  isLoading.value = true

  try {
    if (docmostService) {
      // Docmost AI 流式问答（多轮对话 + 来源引用卡片化）
      for await (const event of docmostService.aiAnswers(messageContent, getCurrentPageSlugId(), history)) {
        if (event.sources) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = { ...currentMsg, sources: event.sources }
        }
        if (event.content) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = {
            ...currentMsg,
            content: currentMsg.content + event.content
          }
        }
        if (event.error) {
          throw new Error(event.error)
        }
      }
      const currentMsg = messages.value[assistantIndex]
      messages.value[assistantIndex] = { ...currentMsg, isStreaming: false }
    } else if (difyService) {
      // Dify API 流式问答（原有逻辑，不支持多轮历史）
      for await (const event of difyService.sendMessage(
        messageContent,
        conversationId.value || undefined
      )) {
        if ((event.event === 'message' || event.event === 'agent_message') && event.answer) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = {
            ...currentMsg,
            content: currentMsg.content + event.answer
          }
        } else if (event.event === 'message_end') {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = { ...currentMsg, isStreaming: false }
          if (event.conversation_id) {
            conversationId.value = event.conversation_id
          }
        } else if (event.event === 'error') {
          throw new Error('AI 服务返回错误')
        }
      }
    }
    saveHistory()
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : '发送失败，请重试'
    error.value = errorMessage
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
  if (confirm('确定要清空当前页面的对话历史吗？')) {
    messages.value = []
    conversationId.value = null
    error.value = null
    storage.remove(getChatStorageKey())
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
  docmostService?.abort()
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

// ===== 路由变化：切换页面时加载对应会话 =====
watch(() => route.path, () => {
  if (!isLoading.value) {
    loadHistory()
  }
})

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
          <div class="ai-chat-messages" ref="messagesContainerRef">
            <!-- 欢迎页 + 推荐问题 -->
            <AIChatWelcome
              v-if="!hasMessages"
              :modifier-key="modifierKey"
              :is-configured="isConfigured"
              @ask="handleSubmit"
            />

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
