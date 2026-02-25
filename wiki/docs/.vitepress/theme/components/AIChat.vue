<script setup lang="ts">
/**
 * AI 问答面板组件
 * 使用 ant-design-x-vue 重构，支持流式响应和 Markdown 渲染
 * 
 * 需求: 6.1-6.12, 8.5
 */
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
import type { ChatMessage, StoredChatHistory } from '../types'
import { StorageKey } from '../types'
import CloseIcon from './icons/CloseIcon.vue'
import TrashIcon from './icons/TrashIcon.vue'

// 获取主题状态
const { isDark } = useTheme()

// 消息列表容器 ref（用于代码复制事件委托）
const messagesContainerRef = ref<HTMLElement | null>(null)
useCodeCopy(messagesContainerRef)

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
// Docmost AI 服务
const docmostService = createDocmostService()
const useDocmostAI = computed(() => !!docmostService)
const isConfigured = computed(() => {
  if (docmostService) return true
  return difyService?.isConfigured() ?? false
})
const hasMessages = computed(() => messages.value.length > 0)
const canSend = computed(() => inputText.value.trim().length > 0 && !isLoading.value)

// ===== Markdown 渲染 =====
const renderMarkdown = (content: string) => {
  if (!content) return h('span')

  return h('div', {
    class: 'ai-chat-markdown',
    innerHTML: renderMarkdownToHtml(content)
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
    messageRender: msg.role === 'assistant' ? renderMarkdown : undefined,
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

// ===== 生成消息 ID =====
function generateMessageId(role: 'user' | 'assistant'): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ===== 历史记录管理（按页面隔离） =====
const loadHistory = () => {
  const key = getChatStorageKey()
  const history = storage.get<StoredChatHistory>(key)
  if (history) {
    messages.value = history.messages
    conversationId.value = history.conversationId || null
  } else {
    messages.value = []
    conversationId.value = null
  }
  error.value = null
}

const saveHistory = () => {
  const key = getChatStorageKey()
  const history: StoredChatHistory = {
    conversationId: conversationId.value || '',
    messages: messages.value.filter(m => !m.isStreaming),
    updatedAt: Date.now()
  }
  storage.set(key, history)
}


// AI 来源引用
const aiSources = ref<{ title: string; slugId: string; spaceSlug: string }[]>([])

// 获取当前语言和路由
const route = useRoute()
const getCurrentLang = (): string => {
  const match = route.path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
}

// 按页面隔离会话：以路由路径为 key
const getChatStorageKey = (): string => {
  return `${StorageKey.ChatHistory}:${route.path}`
}

// 从路由提取当前页面 slugId（用于 AI 上下文定位）
const getCurrentPageSlugId = (): string | undefined => {
  const match = route.path.match(/^\/(zh|en|vi)\/docs\/[^/]+\/([^/]+)/)
  return match ? match[2] : undefined
}

// ===== 发送消息 =====
const sendMessage = async (content: string) => {
  const messageContent = content.trim()
  if (!messageContent) return

  if (!docmostService && !difyService) {
    error.value = 'AI 服务未配置，请检查环境变量'
    return
  }

  inputText.value = ''
  error.value = null
  aiSources.value = []

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
    const assistantIndex = messages.value.length - 1

    if (docmostService) {
      // Docmost AI 流式问答（传递当前页面 slugId 作为上下文）
      for await (const event of docmostService.aiAnswers(messageContent, getCurrentPageSlugId())) {
        if (event.sources) {
          aiSources.value = event.sources
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
      // 追加来源引用到消息末尾
      if (aiSources.value.length > 0) {
        const lang = getCurrentLang()
        const sourcesText = '\n\n---\n**相关文档：**\n' +
          aiSources.value.map(s => `- [${s.title}](/${lang}/docs/${s.spaceSlug}/${s.slugId})`).join('\n')
        const currentMsg = messages.value[assistantIndex]
        messages.value[assistantIndex] = {
          ...currentMsg,
          content: currentMsg.content + sourcesText,
          isStreaming: false
        }
      } else {
        const currentMsg = messages.value[assistantIndex]
        messages.value[assistantIndex] = { ...currentMsg, isStreaming: false }
      }
    } else if (difyService) {
      // Dify API 流式问答（原有逻辑）
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

/* ===== Bubble.List 样式覆盖 ===== */
.bubble-list {
  height: 100%;
}

:deep(.ant-bubble-content) {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

/* 用户气泡：filled 橙色 */
:deep(.ant-bubble[class*="end"]) {
  max-width: 85%;
}

/* 助手气泡：borderless，全宽，无背景 */
:deep(.ant-bubble[class*="start"]) {
  max-width: 100%;
}

:deep(.ant-bubble[class*="start"] .ant-bubble-content) {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  box-shadow: none !important;
}

/* ===== AI Markdown 渲染样式 ===== */
:deep(.ai-chat-markdown) {
  word-break: break-word;
  color: var(--c-text-1);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

/* 首末元素 margin 消除 */
:deep(.ai-chat-markdown > *:first-child) {
  margin-top: 0 !important;
}

:deep(.ai-chat-markdown > *:last-child) {
  margin-bottom: 0 !important;
}

/* 段落 */
:deep(.ai-chat-markdown p) {
  margin: 0.5em 0;
}

/* 标题（缩小比例适配 400px 面板） */
:deep(.ai-chat-markdown h1) {
  font-size: 1.4em;
  font-weight: var(--font-weight-bold);
  margin: 1em 0 0.5em;
  color: var(--c-text-1);
  border-bottom: 1px solid var(--c-border);
  padding-bottom: 0.3em;
}

:deep(.ai-chat-markdown h2) {
  font-size: 1.25em;
  font-weight: var(--font-weight-semibold);
  margin: 0.8em 0 0.4em;
  color: var(--c-text-1);
}

:deep(.ai-chat-markdown h3) {
  font-size: 1.1em;
  font-weight: var(--font-weight-semibold);
  margin: 0.7em 0 0.3em;
  color: var(--c-text-1);
}

:deep(.ai-chat-markdown h4),
:deep(.ai-chat-markdown h5),
:deep(.ai-chat-markdown h6) {
  font-size: 1em;
  font-weight: var(--font-weight-semibold);
  margin: 0.6em 0 0.3em;
  color: var(--c-text-2);
}

/* 列表（恢复 list-style，因 base.css 全局重置了） */
:deep(.ai-chat-markdown ul) {
  list-style: disc;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

:deep(.ai-chat-markdown ol) {
  list-style: decimal;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

:deep(.ai-chat-markdown li) {
  margin: 0.2em 0;
}

:deep(.ai-chat-markdown li > ul),
:deep(.ai-chat-markdown li > ol) {
  margin: 0.1em 0;
}

/* 引用（左侧橙色边框 + 背景） */
:deep(.ai-chat-markdown blockquote) {
  margin: 0.5em 0;
  padding: 0.5em 0.8em;
  border-left: 3px solid var(--c-accent);
  background-color: var(--c-bg-soft);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--c-text-2);
}

:deep(.ai-chat-markdown blockquote p) {
  margin: 0.25em 0;
}

/* 表格 */
:deep(.ai-chat-markdown table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 0.5em 0;
  border-collapse: collapse;
  font-size: 0.9em;
}

:deep(.ai-chat-markdown th),
:deep(.ai-chat-markdown td) {
  padding: 6px 10px;
  border: 1px solid var(--c-border);
  text-align: left;
}

:deep(.ai-chat-markdown th) {
  background-color: var(--c-bg-mute);
  font-weight: var(--font-weight-semibold);
}

:deep(.ai-chat-markdown tr:nth-child(even)) {
  background-color: var(--c-bg-soft);
}

/* 代码块 wrapper */
:deep(.ai-chat-markdown .code-block-wrapper) {
  margin: 0.5em 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background-color: var(--c-bg-alt);
  border: 1px solid var(--c-border);
}

:deep(.ai-chat-markdown .code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background-color: var(--c-bg-mute);
  border-bottom: 1px solid var(--c-border);
}

:deep(.ai-chat-markdown .code-lang-label) {
  font-family: var(--font-family-mono);
  font-size: 11px;
  color: var(--c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:deep(.ai-chat-markdown .code-copy-btn) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  transition: color var(--transition-fast), background-color var(--transition-fast);
}

:deep(.ai-chat-markdown .code-copy-btn:hover) {
  color: var(--c-text-1);
  background-color: var(--c-hover);
}

:deep(.ai-chat-markdown .code-block-body) {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 1.6;
  background: transparent;
}

:deep(.ai-chat-markdown .code-block-body code) {
  font-size: inherit;
  background: none;
  padding: 0;
}

/* 行内代码 */
:deep(.ai-chat-markdown code) {
  padding: 2px 6px;
  background-color: var(--c-bg-alt);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  color: var(--c-accent);
}

/* 链接 */
:deep(.ai-chat-markdown a) {
  color: var(--c-accent);
  text-decoration: none;
}

:deep(.ai-chat-markdown a:hover) {
  text-decoration: underline;
}

/* 粗体、斜体 */
:deep(.ai-chat-markdown strong) {
  font-weight: var(--font-weight-semibold);
}

:deep(.ai-chat-markdown em) {
  font-style: italic;
}

/* 分割线 */
:deep(.ai-chat-markdown hr) {
  margin: 0.8em 0;
  border: none;
  border-top: 1px solid var(--c-border);
}

/* 图片 */
:deep(.ai-chat-markdown img) {
  max-width: 100%;
  border-radius: var(--radius-md);
  margin: 0.5em 0;
}

/* ===== highlight.js 语法高亮 token 颜色 ===== */

/* Light 主题 */
:deep(.ai-chat-markdown .hljs) {
  color: var(--c-text-1);
}
:deep(.ai-chat-markdown .hljs-comment),
:deep(.ai-chat-markdown .hljs-quote) {
  color: #6a737d;
  font-style: italic;
}
:deep(.ai-chat-markdown .hljs-keyword),
:deep(.ai-chat-markdown .hljs-selector-tag),
:deep(.ai-chat-markdown .hljs-built_in) {
  color: #d73a49;
}
:deep(.ai-chat-markdown .hljs-string),
:deep(.ai-chat-markdown .hljs-attr),
:deep(.ai-chat-markdown .hljs-addition) {
  color: #22863a;
}
:deep(.ai-chat-markdown .hljs-number),
:deep(.ai-chat-markdown .hljs-literal) {
  color: #005cc5;
}
:deep(.ai-chat-markdown .hljs-title),
:deep(.ai-chat-markdown .hljs-section) {
  color: #6f42c1;
}
:deep(.ai-chat-markdown .hljs-type),
:deep(.ai-chat-markdown .hljs-name) {
  color: #e36209;
}
:deep(.ai-chat-markdown .hljs-deletion) {
  color: #b31d28;
  background-color: #ffeef0;
}
:deep(.ai-chat-markdown .hljs-meta) {
  color: #735c0f;
}

/* Dark 主题 */
.dark :deep(.ai-chat-markdown .hljs) {
  color: #e1e4e8;
}
.dark :deep(.ai-chat-markdown .hljs-comment),
.dark :deep(.ai-chat-markdown .hljs-quote) {
  color: #6a737d;
  font-style: italic;
}
.dark :deep(.ai-chat-markdown .hljs-keyword),
.dark :deep(.ai-chat-markdown .hljs-selector-tag),
.dark :deep(.ai-chat-markdown .hljs-built_in) {
  color: #f97583;
}
.dark :deep(.ai-chat-markdown .hljs-string),
.dark :deep(.ai-chat-markdown .hljs-attr),
.dark :deep(.ai-chat-markdown .hljs-addition) {
  color: #85e89d;
}
.dark :deep(.ai-chat-markdown .hljs-number),
.dark :deep(.ai-chat-markdown .hljs-literal) {
  color: #79b8ff;
}
.dark :deep(.ai-chat-markdown .hljs-title),
.dark :deep(.ai-chat-markdown .hljs-section) {
  color: #b392f0;
}
.dark :deep(.ai-chat-markdown .hljs-type),
.dark :deep(.ai-chat-markdown .hljs-name) {
  color: #ffab70;
}
.dark :deep(.ai-chat-markdown .hljs-deletion) {
  color: #fdaeb7;
  background-color: #86181d;
}
.dark :deep(.ai-chat-markdown .hljs-meta) {
  color: #dbab09;
}

/* ===== 流式打字光标 ===== */
:deep(.is-streaming .ai-chat-markdown > *:last-child::after) {
  content: '▍';
  display: inline;
  color: var(--c-accent);
  animation: blink-cursor 1s step-end infinite;
  font-weight: 100;
  margin-left: 1px;
}

@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
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
