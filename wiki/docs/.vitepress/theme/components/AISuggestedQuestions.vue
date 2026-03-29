<script setup lang="ts">
defineProps<{
  questions: string[]
}>()

const emit = defineEmits<{
  (e: 'ask', question: string): void
}>()
</script>

<template>
  <div v-if="questions.length > 0" class="ai-suggested-questions">
    <div class="suggested-label">你可能还想问：</div>
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
