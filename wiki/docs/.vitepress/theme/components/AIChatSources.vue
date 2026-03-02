<script setup lang="ts">
/**
 * AI 来源引用卡片组件
 * 可折叠展示 AI 回答引用的文档来源
 */
import { ref } from 'vue'
import { useRoute } from 'vitepress'
import type { AiSource } from '../types'

const props = defineProps<{
  sources: AiSource[]
}>()

const route = useRoute()
const expanded = ref(false)

const getCurrentLang = (): string => {
  const match = route.path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
}

const getSourceUrl = (source: AiSource): string => {
  const lang = getCurrentLang()
  return `/${lang}/docs/${source.spaceSlug}/${source.slugId}`
}
</script>

<template>
  <div v-if="sources.length > 0" class="ai-chat-sources">
    <button
      class="ai-chat-sources-toggle"
      @click="expanded = !expanded"
    >
      <span class="arrow" :class="{ expanded }">▶</span>
      <span>{{ sources.length }} 个相关来源</span>
    </button>
    <div v-if="expanded" class="ai-chat-sources-list">
      <a
        v-for="source in sources"
        :key="source.slugId"
        :href="getSourceUrl(source)"
        target="_blank"
        rel="noopener noreferrer"
        class="ai-chat-source-card"
      >
        <span class="source-icon">📄</span>
        <span class="source-title">{{ source.title || 'Untitled' }}</span>
      </a>
    </div>
  </div>
</template>
