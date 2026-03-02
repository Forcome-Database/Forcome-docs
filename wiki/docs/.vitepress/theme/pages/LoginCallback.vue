<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth'

const { loginWithDingTalkCode, isLoading } = useAuth()
const error = ref('')
const processing = ref(true)

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const authCode = params.get('authCode')
  const state = params.get('state')

  const savedState = sessionStorage.getItem('dingtalk_state')
  const redirectUrl = sessionStorage.getItem('dingtalk_redirect') || '/zh/'
  sessionStorage.removeItem('dingtalk_state')
  sessionStorage.removeItem('dingtalk_redirect')

  if (!authCode) {
    error.value = '未获取到授权码'
    processing.value = false
    return
  }

  if (savedState && state !== savedState) {
    error.value = '安全验证失败，请重新登录'
    processing.value = false
    return
  }

  const success = await loginWithDingTalkCode(authCode)
  if (success) {
    window.location.href = redirectUrl
  } else {
    error.value = '登录失败，请重试'
    processing.value = false
  }
})
</script>

<template>
  <div class="callback-page">
    <div v-if="processing" class="callback-loading">
      <div class="spinner"></div>
      <p>正在完成登录...</p>
    </div>
    <div v-else-if="error" class="callback-error">
      <p>{{ error }}</p>
      <a href="/login">返回登录页</a>
    </div>
  </div>
</template>

<style scoped>
.callback-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--c-bg);
}

.callback-loading, .callback-error {
  text-align: center;
  padding: 32px;
  color: var(--c-text-1);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--c-border);
  border-top-color: #0089ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.callback-error a {
  color: #0089ff;
  margin-top: 16px;
  display: inline-block;
}
</style>
