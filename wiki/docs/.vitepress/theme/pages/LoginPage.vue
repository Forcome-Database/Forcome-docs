<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth'

const { loadDingTalkConfig, loginWithH5Code, isLoading, isInDingTalk } = useAuth()
const error = ref('')
const h5Loading = ref(false)

function getRedirectUrl(): string {
  if (typeof window === 'undefined') return '/'
  const params = new URLSearchParams(window.location.search)
  return params.get('redirect') || '/zh/'
}

async function handleDingTalkLogin() {
  const config = await loadDingTalkConfig()
  if (!config?.enabled || !config.appKey) {
    error.value = '钉钉登录未配置'
    return
  }

  const redirectUri = `${window.location.origin}/login/callback`
  const state = Math.random().toString(36).substring(2)
  sessionStorage.setItem('dingtalk_state', state)
  sessionStorage.setItem('dingtalk_redirect', getRedirectUrl())

  const authUrl =
    `https://login.dingtalk.com/oauth2/auth?` +
    `redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&client_id=${config.appKey}` +
    `&scope=openid` +
    `&state=${state}` +
    `&prompt=consent`

  window.location.href = authUrl
}

async function handleH5SilentLogin() {
  h5Loading.value = true
  try {
    const config = await loadDingTalkConfig()
    if (!config?.enabled || !config.corpId) {
      error.value = '钉钉免登配置缺失'
      return
    }

    const dd = await import('dingtalk-jsapi')

    dd.default.ready(() => {
      dd.default.runtime.permission.requestAuthCode({
        corpId: config.corpId!,
        onSuccess: async (result: { code: string }) => {
          const success = await loginWithH5Code(result.code)
          if (success) {
            window.location.href = getRedirectUrl()
          } else {
            error.value = '免登失败，请重试'
            h5Loading.value = false
          }
        },
        onFail: (err: any) => {
          console.error('[DingTalk H5] requestAuthCode failed:', err)
          error.value = '获取免登授权码失败'
          h5Loading.value = false
        },
      })
    })
  } catch (err) {
    console.error('[DingTalk H5] Error:', err)
    error.value = '钉钉免登异常'
    h5Loading.value = false
  }
}

onMounted(async () => {
  if (isInDingTalk()) {
    await handleH5SilentLogin()
  }
})
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <img src="/images/logo/logo.png" alt="Logo" class="login-logo" />
        <h1>FORCOME 知识库</h1>
        <p class="login-subtitle">请登录后访问</p>
      </div>

      <div v-if="h5Loading" class="login-loading">
        <div class="spinner"></div>
        <p>正在自动登录...</p>
      </div>

      <div v-else class="login-actions">
        <button
          class="dingtalk-login-btn"
          :disabled="isLoading"
          @click="handleDingTalkLogin"
        >
          <svg class="dingtalk-icon" viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-.8 5.42s-.04.55-.29.64c-.25.09-.68-.22-.68-.22s-3.65-2.6-4.03-2.87c-.23-.17-.01-.42-.01-.42s4.33-3.87 4.69-4.22c.36-.35-.13-.19-.13-.19-1.28.85-5.41 3.4-5.94 3.73-.53.33-1.04.24-1.04.24l-2.08-.62s-.78-.33.56-.68c0 0 5.55-2.27 7.36-3.01 1.81-.74 5.29-2.2 5.29-2.2s1.07-.43.9.6z"
            />
          </svg>
          钉钉扫码登录
        </button>

        <p v-if="error" class="login-error">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--c-bg);
  padding: 20px;
}

.login-card {
  max-width: 400px;
  width: 100%;
  padding: 48px 32px;
  border-radius: 12px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  text-align: center;
}

.login-logo {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
}

.login-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--c-text-1);
}

.login-subtitle {
  color: var(--c-text-2);
  margin: 0 0 32px;
}

.dingtalk-login-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 32px;
  font-size: 16px;
  font-weight: 500;
  color: #fff;
  background: #0089ff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.dingtalk-login-btn:hover {
  background: #0070d6;
}

.dingtalk-login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-loading {
  padding: 32px 0;
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

.login-error {
  color: #e53e3e;
  margin-top: 16px;
  font-size: 14px;
}
</style>
