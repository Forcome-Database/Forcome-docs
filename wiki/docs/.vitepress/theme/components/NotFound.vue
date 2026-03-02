<script setup lang="ts">
/**
 * 404 错误页面组件
 * Cursor 风格文档平台
 * 
 * 职责：显示 404 错误页面，提供返回首页链接
 * 需求: 14.5
 */
import { computed } from 'vue'
import { useData } from 'vitepress'

// 获取当前语言
const { localeIndex } = useData()

// 多语言文案
const messages = {
  root: {
    title: '页面未找到',
    description: '抱歉，您访问的页面不存在或已被移动。',
    backHome: '返回首页',
    errorCode: '404'
  },
  zh: {
    title: '页面未找到',
    description: '抱歉，您访问的页面不存在或已被移动。',
    backHome: '返回首页',
    errorCode: '404'
  },
  en: {
    title: 'Page Not Found',
    description: 'Sorry, the page you are looking for does not exist or has been moved.',
    backHome: 'Back to Home',
    errorCode: '404'
  },
  vi: {
    title: 'Không tìm thấy trang',
    description: 'Xin lỗi, trang bạn đang tìm kiếm không tồn tại hoặc đã được di chuyển.',
    backHome: 'Về trang chủ',
    errorCode: '404'
  }
}

// 当前语言的文案
const t = computed(() => {
  const locale = localeIndex.value || 'root'
  return messages[locale as keyof typeof messages] || messages.root
})

// 首页链接
const homeLink = computed(() => {
  const locale = localeIndex.value
  if (locale === 'root' || !locale) return '/'
  return `/${locale}/`
})
</script>

<template>
  <div class="not-found" role="main">
    <div class="not-found-container">
      <!-- 错误码 -->
      <div class="not-found-code" aria-hidden="true">{{ t.errorCode }}</div>
      
      <!-- 标题 -->
      <h1 class="not-found-title">{{ t.title }}</h1>
      
      <!-- 描述 -->
      <p class="not-found-description">{{ t.description }}</p>
      
      <!-- 返回首页按钮 -->
      <a :href="homeLink" class="not-found-link">
        <span class="not-found-link-icon" aria-hidden="true">←</span>
        {{ t.backHome }}
      </a>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  height: calc(100vh - var(--navbar-height));
  overflow: hidden;
  padding: var(--spacing-6);
  text-align: center;
}

.not-found-container {
  max-width: 400px;
}

.not-found-code {
  font-size: 120px;
  font-weight: var(--font-weight-bold);
  line-height: 1;
  color: var(--c-text-4);
  margin-bottom: var(--spacing-4);
  /* 极简风格：使用细线字体 */
  font-family: var(--font-family-base);
  letter-spacing: -4px;
}

.not-found-title {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
  color: var(--c-text-1);
  margin: 0 0 var(--spacing-3);
  line-height: var(--line-height-tight);
}

.not-found-description {
  font-size: var(--font-size-base);
  color: var(--c-text-2);
  margin: 0 0 var(--spacing-6);
  line-height: var(--line-height-relaxed);
}

.not-found-link {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-3) var(--spacing-5);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--c-bg);
  background-color: var(--c-brand);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: 
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.not-found-link:hover {
  background-color: var(--c-brand-light);
  transform: translateY(-1px);
  text-decoration: none;
}

.not-found-link:active {
  transform: translateY(0);
}

.not-found-link:focus-visible {
  outline: 2px solid var(--c-bg);
  outline-offset: 2px;
}

.not-found-link-icon {
  font-size: var(--font-size-lg);
  transition: transform var(--transition-fast);
}

.not-found-link:hover .not-found-link-icon {
  transform: translateX(-2px);
}

/* 深色模式适配 */
.dark .not-found-code {
  color: var(--c-text-4);
}

/* 响应式 */
@media (max-width: 639px) {
  .not-found-code {
    font-size: 80px;
    letter-spacing: -2px;
  }

  .not-found-title {
    font-size: var(--font-size-xl);
  }

  .not-found-description {
    font-size: var(--font-size-sm);
  }
}
</style>
