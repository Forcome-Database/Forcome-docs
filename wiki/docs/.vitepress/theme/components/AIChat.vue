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
import { useRoute, useRouter } from 'vitepress'
import { createDifyService } from '../services/dify'
import { createDocmostService } from '../services/docmost'
import { storage } from '../services/storage'
import { renderMarkdownToHtml } from '../utils/markdown'
import { useDocmostSidebar } from '../composables/useDocmostSidebar'
import type { ChatMessage, ChatMessageImage, StoredChatHistory, DocmostSidebarNode, AiSource, AiHistoryMessage } from '../types'
import { StorageKey } from '../types'
import AIChatSources from './AIChatSources.vue'
import AIChatWelcome from './AIChatWelcome.vue'
import CloseIcon from './icons/CloseIcon.vue'
import TrashIcon from './icons/TrashIcon.vue'
import HistoryIcon from './icons/HistoryIcon.vue'
import ChevronIcon from './icons/ChevronIcon.vue'

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


// ===== 图片上传状态 =====
interface PendingImage {
  id: string
  file: File
  previewUrl: string
  mimeType: string
}
const pendingImages = ref<PendingImage[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB
const MAX_IMAGES = 3

const canSend = computed(() =>
  (inputText.value.trim().length > 0 || pendingImages.value.length > 0) && !isLoading.value
)

// 文件转 base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 去掉 data:...;base64, 前缀
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 压缩图片（超过 MAX_IMAGE_SIZE 时使用）
function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      // 限制最大尺寸
      let { width, height } = img
      const maxDim = 1920
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('压缩失败'))
          resolve(new File([blob], file.name, { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.8
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

async function addImageAttachment(file: File) {
  if (pendingImages.value.length >= MAX_IMAGES) {
    error.value = `最多上传 ${MAX_IMAGES} 张图片`
    return
  }
  if (!file.type.startsWith('image/')) return

  let processedFile = file
  if (file.size > MAX_IMAGE_SIZE) {
    try {
      processedFile = await compressImage(file)
    } catch {
      error.value = '图片压缩失败，请选择更小的图片'
      return
    }
  }

  const previewUrl = URL.createObjectURL(processedFile)
  pendingImages.value.push({
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file: processedFile,
    previewUrl,
    mimeType: processedFile.type
  })
}

function removeImage(id: string) {
  const idx = pendingImages.value.findIndex(img => img.id === id)
  if (idx !== -1) {
    URL.revokeObjectURL(pendingImages.value[idx].previewUrl)
    pendingImages.value.splice(idx, 1)
  }
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  for (const file of Array.from(input.files)) {
    addImageAttachment(file)
  }
  input.value = '' // reset so same file can be re-selected
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) addImageAttachment(file)
    }
  }
}

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

// ===== 用户消息渲染（含图片） =====
const renderUserMessage = (images: ChatMessageImage[]) => (content: string) => {
  const children: any[] = []
  if (images.length > 0) {
    children.push(h('div', { class: 'user-msg-images' },
      images.map(img =>
        h('img', { key: img.id, src: img.previewUrl, class: 'user-msg-thumb', alt: '附件图片' })
      )
    ))
  }
  if (content) {
    children.push(h('span', content))
  }
  return h('div', children)
}

// ===== Bubble.List 数据转换 =====
const bubbleItems = computed(() => {
  return messages.value.map(msg => {
    const hasImages = msg.role === 'user' && msg.images && msg.images.length > 0
    return {
      key: msg.id,
      role: msg.role,
      content: msg.content,
      loading: msg.isStreaming && !msg.content,
      typing: msg.isStreaming ? { step: 2, interval: 50 } : undefined,
      messageRender: msg.role === 'assistant'
        ? (content: string) => renderAssistantMessage(content, msg.sources)
        : hasImages
          ? renderUserMessage(msg.images!)
          : undefined,
      classNames: msg.isStreaming && msg.role === 'assistant'
        ? { content: 'is-streaming' }
        : undefined
    }
  })
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
  // 持久化时去掉图片 blob URL 数据，避免 localStorage 溢出
  const cleanMessages = messages.value
    .filter(m => !m.isStreaming)
    .map(m => {
      if (m.images?.length) {
        const { images, ...rest } = m
        return rest
      }
      return m
    })
  const data: StoredChatHistory = {
    conversationId: conversationId.value || '',
    messages: cleanMessages,
    updatedAt: Date.now()
  }
  storage.set(key, data)
}

// ===== 发送消息（支持多轮对话 + 图片 + 来源卡片） =====
const sendMessage = async (content: string) => {
  const messageContent = content.trim()
  const hasImages = pendingImages.value.length > 0
  if (!messageContent && !hasImages) return

  if (!docmostService && !difyService) {
    error.value = 'AI 服务未配置，请检查环境变量'
    return
  }

  // 捕获待发送的图片
  const imagesToSend = [...pendingImages.value]
  pendingImages.value = []

  // 构建历史（在添加新消息之前）
  const history = buildHistory()

  inputText.value = ''
  error.value = null

  // 添加用户消息（含图片预览）
  const userMessage: ChatMessage = {
    id: generateMessageId('user'),
    role: 'user',
    content: messageContent,
    timestamp: Date.now(),
    images: imagesToSend.length > 0
      ? imagesToSend.map(img => ({ id: img.id, previewUrl: img.previewUrl, mimeType: img.mimeType }))
      : undefined
  }
  messages.value.push(userMessage)

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
      // 准备图片 base64 数据
      let imagePayload: { data: string; mimeType: string }[] | undefined
      if (imagesToSend.length > 0) {
        imagePayload = await Promise.all(
          imagesToSend.map(async (img) => ({
            data: await fileToBase64(img.file),
            mimeType: img.mimeType,
          }))
        )
      }

      // Docmost AI 流式问答（多轮对话 + 图片 + 来源引用卡片化）
      for await (const event of docmostService.aiAnswers(messageContent, getCurrentPageSlugId(), imagePayload, history)) {
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
  updatePageTitle()
  closeHistory()
})

// ===== 历史记录功能 =====
const router = useRouter()
const { sidebarData } = useDocmostSidebar()

interface HistoryEntry {
  routePath: string
  pageTitle: string
  lastMessage: string
  messageCount: number
  updatedAt: number
}

const showHistory = ref(false)
const historyEntries = ref<HistoryEntry[]>([])

// 从 sidebar 数据中根据 slugId 递归查找页面标题
function findNodeBySlugId(nodes: DocmostSidebarNode[], slugId: string): string | null {
  for (const node of nodes) {
    if (node.slugId === slugId) return node.title
    if (node.children?.length) {
      const found = findNodeBySlugId(node.children, slugId)
      if (found) return found
    }
  }
  return null
}

function resolvePageTitle(routePath: string): string {
  // 从路由路径提取 slugId
  const match = routePath.match(/^\/(zh|en|vi)\/docs\/([^/]+)\/([^/]+)/)
  if (!match) return routePath
  const spaceSlug = match[2]
  const slugId = match[3]

  // 从 sidebar 缓存中查找
  const spaceNodes = sidebarData.value[spaceSlug]
  if (spaceNodes) {
    const title = findNodeBySlugId(spaceNodes, slugId)
    if (title) return title
  }
  return slugId
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  return `${months}个月前`
}

function loadHistoryEntries() {
  if (typeof localStorage === 'undefined') return
  const prefix = `${StorageKey.ChatHistory}:`
  const entries: HistoryEntry[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix)) continue

    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const history: StoredChatHistory = JSON.parse(raw)
      if (!history.messages || history.messages.length === 0) continue

      const routePath = key.slice(prefix.length)
      const lastMsg = history.messages[history.messages.length - 1]
      entries.push({
        routePath,
        pageTitle: resolvePageTitle(routePath),
        lastMessage: lastMsg.content.slice(0, 80),
        messageCount: history.messages.length,
        updatedAt: history.updatedAt || lastMsg.timestamp
      })
    } catch {
      // ignore parse errors
    }
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  historyEntries.value = entries
}

function openHistory() {
  loadHistoryEntries()
  showHistory.value = true
}

function closeHistory() {
  showHistory.value = false
}

function navigateToHistory(entry: HistoryEntry) {
  closeHistory()
  router.go(entry.routePath)
}

// ===== 当前页面标题标签 =====
const pageTitle = ref('')

const updatePageTitle = () => {
  if (typeof document === 'undefined') return
  const title = document.title || ''
  // 去掉站点后缀（如 " | FORCOME 知识库"）
  pageTitle.value = title.replace(/\s*[|·–—]\s*[^|·–—]+$/, '').trim()
}

const onContentLoaded = () => updatePageTitle()

// ===== 生命周期 =====
onMounted(() => {
  loadHistory()
  updatePageTitle()
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('docmost-content-loaded', onContentLoaded)
})

onUnmounted(() => {
  abort()
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('docmost-content-loaded', onContentLoaded)
  // 清理图片 blob URLs
  pendingImages.value.forEach(img => URL.revokeObjectURL(img.previewUrl))
  messages.value.forEach(m => m.images?.forEach(img => URL.revokeObjectURL(img.previewUrl)))
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
          <h2 class="ai-chat-title" id="ai-chat-title">智能助手康康</h2>
        </div>
        <div class="ai-chat-actions">
          <button
            v-if="!isEmbedMode"
            class="ai-chat-action-btn"
            type="button"
            aria-label="历史记录"
            @click="openHistory"
          >
            <HistoryIcon :size="16" />
          </button>
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
          <div v-if="!showHistory" class="ai-chat-messages" ref="messagesContainerRef">
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

          <!-- 历史记录面板 -->
          <div v-else class="ai-chat-history-panel">
            <div class="history-header">
              <button class="history-back-btn" type="button" @click="closeHistory">
                <ChevronIcon :size="16" direction="left" />
              </button>
              <span class="history-header-title">历史记录</span>
            </div>
            <div v-if="historyEntries.length === 0" class="history-empty">
              暂无历史记录
            </div>
            <div v-else class="history-list">
              <button
                v-for="entry in historyEntries"
                :key="entry.routePath"
                class="history-item"
                :class="{ 'is-current': entry.routePath === route.path }"
                type="button"
                @click="navigateToHistory(entry)"
              >
                <div class="history-item-header">
                  <span class="history-item-title">{{ entry.pageTitle }}</span>
                  <span class="history-item-time">{{ formatRelativeTime(entry.updatedAt) }}</span>
                </div>
                <div class="history-item-preview">{{ entry.lastMessage }}</div>
                <div class="history-item-count">{{ entry.messageCount }} 条消息</div>
              </button>
            </div>
          </div>

          <!-- 输入区域 -->
          <footer class="ai-chat-footer" @paste="handlePaste">
            <!-- 当前页面上下文标签 -->
            <div v-if="pageTitle" class="ai-chat-context-tag" :title="pageTitle">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <span>{{ pageTitle }}</span>
            </div>

            <!-- 图片预览条 -->
            <div v-if="pendingImages.length > 0" class="ai-chat-image-preview">
              <div v-for="img in pendingImages" :key="img.id" class="image-preview-item">
                <img :src="img.previewUrl" alt="待发送图片" class="image-preview-thumb" />
                <button class="image-preview-remove" type="button" @click="removeImage(img.id)" aria-label="移除图片">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            <!-- 隐藏的文件选择器 -->
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              multiple
              style="display: none"
              @change="handleFileSelect"
            />

            <Sender
              v-model:value="inputText"
              placeholder="输入你的问题..."
              :loading="isLoading"
              submit-type="enter"
              class="ai-chat-sender"
              @submit="handleSubmit"
              @cancel="abort"
            >
              <template #prefix>
                <button
                  class="ai-chat-upload-btn"
                  type="button"
                  aria-label="上传图片"
                  :disabled="pendingImages.length >= MAX_IMAGES"
                  @click="fileInputRef?.click()"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </button>
              </template>
            </Sender>
            <p class="ai-chat-input-hint">
              <kbd>Enter</kbd> 发送 · <kbd>Shift+Enter</kbd> 换行 · <kbd>ESC</kbd> 关闭 · 可粘贴图片
            </p>
          </footer>
        </XProvider>
      </template>
    </aside>
    </Teleport>
  </div>
</template>
