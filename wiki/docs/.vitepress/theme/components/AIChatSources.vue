<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vitepress'
import type { AiCitation, AiSource } from '../types'

const props = defineProps<{
  sources?: AiSource[]
  citations?: AiCitation[]
}>()

const route = useRoute()
const expanded = ref(false)

const getCurrentLang = (): string => {
  const match = route.path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
}

const getPageUrl = (source: { spaceSlug?: string; pageSlugId?: string; slugId?: string }): string => {
  const lang = getCurrentLang()
  const slugId = source.pageSlugId || source.slugId
  if (!source.spaceSlug || !slugId) return '#'
  return `/${lang}/docs/${source.spaceSlug}/${slugId}`
}

const normalizedItems = computed(() => {
  if (props.citations && props.citations.length > 0) {
    return props.citations.map((citation, index) => {
      const isExternal = (citation as any).origin === 'web'

      const icon =
        isExternal
          ? '🌐'
          : citation.sourceType === 'attachment'
            ? '📎'
            : citation.sourceType === 'image'
              ? '🖼️'
              : citation.sourceType === 'diagram'
                ? '📐'
                : '📄'

      // For external sources, use pageUrl directly
      const href = isExternal
        ? citation.pageUrl || '#'
        : citation.sourceType === 'page'
          ? getPageUrl(citation)
          : citation.publicAssetUrl || getPageUrl(citation)

      return {
        key: `${citation.sourceType}-${citation.attachmentId || citation.pageSlugId || citation.slugId || index}`,
        title: citation.title || 'Untitled',
        href,
        icon,
        snippet: citation.snippet || '',
        cited: citation.cited,
      }
    })
  }

  return (props.sources || []).map((source) => ({
    key: `${source.spaceSlug}-${source.slugId}`,
    title: source.title || 'Untitled',
    href: getPageUrl(source),
    icon: '📄',
    snippet: '',
    cited: source.cited,
  }))
})
</script>

<template>
  <div v-if="normalizedItems.length > 0" class="ai-chat-sources">
    <button
      class="ai-chat-sources-toggle"
      @click="expanded = !expanded"
    >
      <span class="arrow" :class="{ expanded }">▸</span>
      <span>{{ normalizedItems.length }} 个相关来源</span>
    </button>
    <div v-if="expanded" class="ai-chat-sources-list">
      <a
        v-for="item in normalizedItems"
        :key="item.key"
        :href="item.href"
        target="_blank"
        rel="noopener noreferrer"
        class="ai-chat-source-card"
        :class="{ 'uncited': item.cited === false }"
      >
        <span class="source-icon">{{ item.icon }}</span>
        <div class="source-content">
          <span class="source-title">{{ item.title }}</span>
          <span v-if="item.snippet" class="source-snippet">{{ item.snippet }}</span>
        </div>
      </a>
    </div>
  </div>
</template>
