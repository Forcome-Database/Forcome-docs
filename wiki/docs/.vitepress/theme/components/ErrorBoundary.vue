<script setup lang="ts">
/**
 * 错误边界组件
 * Cursor 风格文档平台
 * 
 * 职责：捕获子组件错误，显示友好提示，提供重试按钮
 * 需求: 14.3-14.4
 */
import { ref, onErrorCaptured, computed } from 'vue'
import { useData } from 'vitepress'
import { AppError, getErrorMessage } from '../services/errors'
import { ErrorType } from '../types'

// Props
interface Props {
  /** 自定义错误标题 */
  title?: string
  /** 是否显示详细错误信息（开发模式） */
  showDetails?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showDetails: import.meta.env.DEV
})

// Emits
const emit = defineEmits<{
  (e: 'error', error: Error): void
  (e: 'retry'): void
}>()

// 获取当前语言
const { localeIndex } = useData()

// 多语言文案
const messages = {
  root: {
    defaultTitle: '出错了',
    networkError: '网络连接失败',
    apiError: '服务暂时不可用',
    storageError: '本地存储不可用',
    unknownError: '发生未知错误',
    description: '抱歉，页面加载时遇到了问题。',
    retry: '重试',
    reload: '刷新页面',
    details: '错误详情'
  },
  zh: {
    defaultTitle: '出错了',
    networkError: '网络连接失败',
    apiError: '服务暂时不可用',
    storageError: '本地存储不可用',
    unknownError: '发生未知错误',
    description: '抱歉，页面加载时遇到了问题。',
    retry: '重试',
    reload: '刷新页面',
    details: '错误详情'
  },
  en: {
    defaultTitle: 'Something went wrong',
    networkError: 'Network connection failed',
    apiError: 'Service temporarily unavailable',
    storageError: 'Local storage unavailable',
    unknownError: 'An unknown error occurred',
    description: 'Sorry, there was a problem loading this page.',
    retry: 'Retry',
    reload: 'Reload Page',
    details: 'Error Details'
  },
  vi: {
    defaultTitle: 'Đã xảy ra lỗi',
    networkError: 'Kết nối mạng thất bại',
    apiError: 'Dịch vụ tạm thời không khả dụng',
    storageError: 'Bộ nhớ cục bộ không khả dụng',
    unknownError: 'Đã xảy ra lỗi không xác định',
    description: 'Xin lỗi, đã xảy ra sự cố khi tải trang này.',
    retry: 'Thử lại',
    reload: 'Tải lại trang',
    details: 'Chi tiết lỗi'
  }
}

// 当前语言的文案
const t = computed(() => {
  const locale = localeIndex.value || 'root'
  return messages[locale as keyof typeof messages] || messages.root
})

// 错误状态
const hasError = ref(false)
const error = ref<Error | null>(null)
const errorType = ref<ErrorType>(ErrorType.Unknown)

// 根据错误类型获取标题
const errorTitle = computed(() => {
  if (props.title) return props.title
  
  switch (errorType.value) {
    case ErrorType.Network:
      return t.value.networkError
    case ErrorType.Api:
      return t.value.apiError
    case ErrorType.Storage:
      return t.value.storageError
    default:
      return t.value.defaultTitle
  }
})

// 错误消息
const errorMessage = computed(() => {
  if (!error.value) return t.value.description
  return getErrorMessage(error.value)
})

// 捕获子组件错误
onErrorCaptured((err: Error) => {
  hasError.value = true
  error.value = err
  
  // 识别错误类型
  if (err instanceof AppError) {
    errorType.value = err.type
  } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
    errorType.value = ErrorType.Network
  } else {
    errorType.value = ErrorType.Unknown
  }
  
  // 触发错误事件
  emit('error', err)
  
  // 阻止错误继续传播
  return false
})

// 重试
const handleRetry = () => {
  hasError.value = false
  error.value = null
  errorType.value = ErrorType.Unknown
  emit('retry')
}

// 刷新页面
const handleReload = () => {
  window.location.reload()
}

// 是否展开详情
const showDetailsExpanded = ref(false)
</script>

<template>
  <div v-if="hasError" class="error-boundary" role="alert" aria-live="assertive">
    <div class="error-boundary-container">
      <!-- 错误图标 -->
      <div class="error-boundary-icon" aria-hidden="true">
        <svg 
          width="48" 
          height="48" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="1.5"
          stroke-linecap="round" 
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      
      <!-- 错误标题 -->
      <h2 class="error-boundary-title">{{ errorTitle }}</h2>
      
      <!-- 错误描述 -->
      <p class="error-boundary-description">{{ errorMessage }}</p>
      
      <!-- 操作按钮 -->
      <div class="error-boundary-actions" role="group" aria-label="错误恢复操作">
        <button 
          class="error-boundary-btn error-boundary-btn-primary"
          @click="handleRetry"
          type="button"
        >
          {{ t.retry }}
        </button>
        <button 
          class="error-boundary-btn error-boundary-btn-secondary"
          @click="handleReload"
          type="button"
        >
          {{ t.reload }}
        </button>
      </div>
      
      <!-- 错误详情（开发模式） -->
      <div v-if="showDetails && error" class="error-boundary-details">
        <button 
          class="error-boundary-details-toggle"
          @click="showDetailsExpanded = !showDetailsExpanded"
          type="button"
          :aria-expanded="showDetailsExpanded"
          aria-controls="error-details"
        >
          {{ t.details }}
          <span class="error-boundary-details-arrow" :class="{ expanded: showDetailsExpanded }" aria-hidden="true">
            ▼
          </span>
        </button>
        <pre 
          v-if="showDetailsExpanded" 
          id="error-details"
          class="error-boundary-stack"
        >{{ error.stack || error.message }}</pre>
      </div>
    </div>
  </div>
  
  <!-- 正常渲染插槽内容 -->
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: var(--spacing-6);
  text-align: center;
}

.error-boundary-container {
  max-width: 400px;
}

.error-boundary-icon {
  display: flex;
  justify-content: center;
  margin-bottom: var(--spacing-4);
  color: var(--c-error);
}

.error-boundary-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--c-text-1);
  margin: 0 0 var(--spacing-2);
  line-height: var(--line-height-tight);
}

.error-boundary-description {
  font-size: var(--font-size-sm);
  color: var(--c-text-2);
  margin: 0 0 var(--spacing-5);
  line-height: var(--line-height-relaxed);
}

.error-boundary-actions {
  display: flex;
  gap: var(--spacing-3);
  justify-content: center;
  flex-wrap: wrap;
}

.error-boundary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: 
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.error-boundary-btn:active {
  transform: translateY(1px);
}

.error-boundary-btn-primary {
  color: var(--c-bg);
  background-color: var(--c-brand);
  border: 1px solid var(--c-brand);
}

.error-boundary-btn-primary:hover {
  background-color: var(--c-brand-light);
  border-color: var(--c-brand-light);
}

.error-boundary-btn-primary:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: 2px;
}

.error-boundary-btn-secondary {
  color: var(--c-text-1);
  background-color: transparent;
  border: 1px solid var(--c-border);
}

.error-boundary-btn-secondary:hover {
  background-color: var(--c-hover);
  border-color: var(--c-border-dark);
}

.error-boundary-btn-secondary:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

/* 错误详情 */
.error-boundary-details {
  margin-top: var(--spacing-6);
  text-align: left;
}

.error-boundary-details-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  width: 100%;
  padding: var(--spacing-2) 0;
  font-size: var(--font-size-xs);
  color: var(--c-text-3);
  background: none;
  border: none;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.error-boundary-details-toggle:hover {
  color: var(--c-text-2);
}

.error-boundary-details-arrow {
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.error-boundary-details-arrow.expanded {
  transform: rotate(180deg);
}

.error-boundary-stack {
  margin-top: var(--spacing-2);
  padding: var(--spacing-3);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--c-text-2);
  background-color: var(--c-bg-soft);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

/* 响应式 */
@media (max-width: 639px) {
  .error-boundary-title {
    font-size: var(--font-size-lg);
  }

  .error-boundary-actions {
    flex-direction: column;
  }

  .error-boundary-btn {
    width: 100%;
  }
}
</style>
