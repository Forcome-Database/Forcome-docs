/**
 * AI 问答状态管理 Composable
 * 提供 AI 对话状态、消息管理、Dify API 集成、历史记录持久化
 * 支持 API 模式和 iframe 嵌入模式切换
 * 
 * 需求: 6.1-6.12
 */

import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { DifyService, createDifyService } from '../services/dify'
import { storage } from '../services/storage'
import type { ChatMessage, StoredChatHistory, DifyMode } from '../types'
import { StorageKey } from '../types'

/**
 * 获取 Dify 模式配置
 */
export function getDifyMode(): DifyMode {
  const mode = import.meta.env.VITE_DIFY_MODE as string
  return mode === 'embed' ? 'embed' : 'api'
}

/**
 * 获取 Dify 嵌入链接 URL
 */
export function getDifyEmbedUrl(): string {
  return import.meta.env.VITE_DIFY_EMBED_URL as string || ''
}

/**
 * 检查嵌入模式是否已配置
 */
export function isEmbedConfigured(): boolean {
  return getDifyMode() === 'embed' && !!getDifyEmbedUrl()
}

/**
 * 生成唯一消息 ID
 */
function generateMessageId(role: 'user' | 'assistant'): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * AI 问答状态管理 Hook
 * 
 * @returns AI 问答状态和操作方法
 * 
 * @example
 * ```ts
 * const {
 *   isOpen,
 *   messages,
 *   isLoading,
 *   error,
 *   open,
 *   close,
 *   sendMessage,
 *   clearHistory
 * } = useAIChat()
 * ```
 */
export function useAIChat() {
  // ===== 状态 =====
  
  /** AI 面板是否打开 */
  const isOpen = ref(false)
  
  /** 消息列表 */
  const messages = ref<ChatMessage[]>([])
  
  /** 对话 ID（用于多轮对话） */
  const conversationId = ref<string | null>(null)
  
  /** 是否正在加载 */
  const isLoading = ref(false)
  
  /** 错误信息 */
  const error = ref<string | null>(null)
  
  /** 输入框内容 */
  const inputText = ref('')
  
  /** 输入框引用（用于自动聚焦） */
  const inputRef = ref<HTMLTextAreaElement | null>(null)
  
  /** 消息列表容器引用（用于滚动） */
  const messagesRef = ref<HTMLElement | null>(null)

  // Dify 服务实例（立即初始化，避免 SSR 问题）
  let difyService: DifyService | null = null
  
  /** 服务是否已配置（响应式） */
  const serviceConfigured = ref(false)

  // ===== 计算属性 =====
  
  /** 是否有消息 */
  const hasMessages = computed(() => messages.value.length > 0)
  
  /** 是否可以发送消息 */
  const canSend = computed(() => 
    inputText.value.trim().length > 0 && !isLoading.value
  )
  
  /** 服务是否已配置 */
  const isConfigured = computed(() => serviceConfigured.value)

  // ===== 初始化 =====
  
  /**
   * 初始化 Dify 服务
   */
  const initService = () => {
    difyService = createDifyService()
    serviceConfigured.value = difyService?.isConfigured() ?? false
    if (!difyService) {
      console.warn('[useAIChat] Dify 服务未配置，AI 问答功能不可用')
    }
  }

  /**
   * 从 localStorage 加载历史记录（需求 6.7）
   */
  const loadHistory = () => {
    const history = storage.get<StoredChatHistory>(StorageKey.ChatHistory)
    if (history) {
      messages.value = history.messages
      conversationId.value = history.conversationId || null
    }
  }

  /**
   * 保存历史记录到 localStorage（需求 6.6）
   */
  const saveHistory = () => {
    const history: StoredChatHistory = {
      conversationId: conversationId.value || '',
      messages: messages.value.filter(m => !m.isStreaming), // 不保存正在流式输出的消息
      updatedAt: Date.now()
    }
    storage.set(StorageKey.ChatHistory, history)
  }

  // ===== 面板控制 =====
  
  /**
   * 打开 AI 面板（需求 6.1）
   */
  const open = () => {
    isOpen.value = true
    error.value = null
    // 防止背景滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden'
    }
    // 自动聚焦输入框（需求 6.2）
    nextTick(() => {
      inputRef.value?.focus()
    })
  }

  /**
   * 关闭 AI 面板（需求 6.8, 6.9）
   */
  const close = () => {
    isOpen.value = false
    // 恢复背景滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = ''
    }
  }

  /**
   * 切换 AI 面板
   */
  const toggle = () => {
    if (isOpen.value) {
      close()
    } else {
      open()
    }
  }

  // ===== 消息操作 =====
  
  /**
   * 滚动到消息列表底部
   */
  const scrollToBottom = () => {
    nextTick(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  }

  /**
   * 发送消息（需求 6.3, 6.4）
   */
  const sendMessage = async (content?: string) => {
    const messageContent = content || inputText.value.trim()
    
    if (!messageContent) return
    if (!difyService) {
      error.value = 'AI 服务未配置，请检查环境变量'
      return
    }

    // 清空输入框
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
    scrollToBottom()

    // 创建助手消息占位符（用于流式显示）
    const assistantMessage: ChatMessage = {
      id: generateMessageId('assistant'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    }
    messages.value.push(assistantMessage)
    scrollToBottom()

    isLoading.value = true

    try {
      // 调用 Dify API，流式接收响应（需求 6.4）
      for await (const event of difyService.sendMessage(
        messageContent,
        conversationId.value || undefined
      )) {
        // 处理消息事件（message 或 agent_message）
        if ((event.event === 'message' || event.event === 'agent_message') && event.answer) {
          // 追加回答内容（需求 6.10 - 打字效果）
          assistantMessage.content += event.answer
          scrollToBottom()
        } else if (event.event === 'message_end') {
          // 消息结束
          assistantMessage.isStreaming = false
          if (event.conversation_id) {
            conversationId.value = event.conversation_id
          }
        } else if (event.event === 'error') {
          throw new Error('AI 服务返回错误')
        }
      }

      // 保存历史记录
      saveHistory()
    } catch (e) {
      // 错误处理（需求 6.11）
      const errorMessage = e instanceof Error ? e.message : '发送失败，请重试'
      error.value = errorMessage
      
      // 移除失败的助手消息
      const index = messages.value.findIndex(m => m.id === assistantMessage.id)
      if (index !== -1) {
        messages.value.splice(index, 1)
      }
      
      console.error('[useAIChat] 发送消息失败:', e)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 重试上一条消息
   */
  const retry = () => {
    // 找到最后一条用户消息
    const lastUserMessage = [...messages.value]
      .reverse()
      .find(m => m.role === 'user')
    
    if (lastUserMessage) {
      // 移除最后一条用户消息及其后的所有消息
      const index = messages.value.findIndex(m => m.id === lastUserMessage.id)
      if (index !== -1) {
        messages.value.splice(index)
      }
      // 重新发送
      sendMessage(lastUserMessage.content)
    }
  }

  /**
   * 清空对话历史（需求 6.12）
   */
  const clearHistory = () => {
    messages.value = []
    conversationId.value = null
    error.value = null
    storage.remove(StorageKey.ChatHistory)
  }

  /**
   * 取消当前请求
   */
  const abort = () => {
    difyService?.abort()
    isLoading.value = false
    
    // 移除正在流式输出的消息
    const streamingIndex = messages.value.findIndex(m => m.isStreaming)
    if (streamingIndex !== -1) {
      messages.value.splice(streamingIndex, 1)
    }
  }

  // ===== 引用设置 =====
  
  /**
   * 设置输入框引用
   */
  const setInputRef = (el: HTMLTextAreaElement | null) => {
    inputRef.value = el
  }

  /**
   * 设置消息列表容器引用
   */
  const setMessagesRef = (el: HTMLElement | null) => {
    messagesRef.value = el
  }

  // ===== 快捷键处理 =====
  
  /**
   * 处理全局快捷键（需求 6.1 - ⌘I/Ctrl+I）
   */
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    // ⌘I / Ctrl+I 打开 AI 面板
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault()
      toggle()
    }
  }

  /**
   * 处理输入框键盘事件
   */
  const handleInputKeydown = (e: KeyboardEvent) => {
    // Enter 发送消息（不带 Shift）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    // ESC 关闭面板（需求 6.8）
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  // ===== 生命周期 =====
  
  onMounted(() => {
    // 初始化服务
    initService()
    // 加载历史记录
    loadHistory()
    // 注册全局快捷键
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', handleGlobalKeydown)
    }
  })

  onUnmounted(() => {
    // 移除全局快捷键
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleGlobalKeydown)
    }
    // 取消进行中的请求
    difyService?.abort()
    // 确保恢复滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = ''
    }
  })

  return {
    // 状态
    /** AI 面板是否打开 */
    isOpen,
    /** 消息列表 */
    messages,
    /** 对话 ID */
    conversationId,
    /** 是否正在加载 */
    isLoading,
    /** 错误信息 */
    error,
    /** 输入框内容 */
    inputText,
    /** 是否有消息 */
    hasMessages,
    /** 是否可以发送 */
    canSend,
    /** 服务是否已配置 */
    isConfigured,

    // 面板控制
    /** 打开 AI 面板 */
    open,
    /** 关闭 AI 面板 */
    close,
    /** 切换 AI 面板 */
    toggle,

    // 消息操作
    /** 发送消息 */
    sendMessage,
    /** 重试上一条消息 */
    retry,
    /** 清空对话历史 */
    clearHistory,
    /** 取消当前请求 */
    abort,

    // 引用设置
    /** 设置输入框引用 */
    setInputRef,
    /** 设置消息列表容器引用 */
    setMessagesRef,
    /** 处理输入框键盘事件 */
    handleInputKeydown,
    /** 滚动到底部 */
    scrollToBottom
  }
}

/**
 * 获取操作系统对应的快捷键修饰符
 */
export function getAIChatModifierKey(): string {
  if (typeof navigator === 'undefined') return '⌘'
  // 使用 userAgent 替代已废弃的 platform
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  return isMac ? '⌘' : 'Ctrl'
}
