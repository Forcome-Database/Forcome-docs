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
      const href =
        citation.sourceType === 'page'
          ? getPageUrl(citation)
          : citation.publicAssetUrl || getPageUrl(citation)

      const icon =
        citation.sourceType === 'attachment'
          ? '📎'
          : citation.sourceType === 'image'
            ? '🖼️'
            : citation.sourceType === 'diagram'
              ? '📐'
              : '📄'

      return {
        key: `${citation.sourceType}-${citation.attachmentId || citation.pageSlugId || citation.slugId || index}`,
        title: citation.title || 'Untitled',
        href,
        icon,
      }
    })
  }

  return (props.sources || []).map((source) => ({
    key: `${source.spaceSlug}-${source.slugId}`,
    title: source.title || 'Untitled',
    href: getPageUrl(source),
    icon: '📄',
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
      >
        <span class="source-icon">{{ item.icon }}</span>
        <span class="source-title">{{ item.title }}</span>
      </a>
    </div>
  </div>
</template>
