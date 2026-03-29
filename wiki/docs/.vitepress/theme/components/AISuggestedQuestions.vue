<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  questions: string[]
}>()

const emit = defineEmits<{
  (e: 'ask', question: string): void
}>()

const label = computed(() => {
  // Detect language from question content
  const sample = props.questions[0] || ''
  return /[\u4e00-\u9fa5]/.test(sample) ? '你可能还想问：' : 'You might also ask:'
})
</script>

<template>
  <div v-if="questions.length > 0" class="ai-suggested-questions">
    <div class="suggested-label">{{ label }}</div>
    <div class="suggested-list">
      <button
        v-for="(q, i) in questions"
        :key="i"
        class="suggested-btn"
        @click="emit('ask', q)"
      >
        {{ q }}
      </button>
    </div>
  </div>
</template>
