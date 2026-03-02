<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth'

const { loadDingTalkConfig, loginWithH5Code, isLoading, isInDingTalk } = useAuth()
const error = ref('')
const h5Loading = ref(false)
const mounted = ref(false)

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
  // Trigger entrance animations
  requestAnimationFrame(() => {
    mounted.value = true
  })

  if (isInDingTalk()) {
    await handleH5SilentLogin()
  }
})
</script>

<template>
  <div class="login-page" :class="{ 'is-mounted': mounted }">
    <!-- Background decoration -->
    <div class="login-bg">
      <div class="login-bg-grain"></div>
      <div class="login-bg-glow login-bg-glow--1"></div>
      <div class="login-bg-glow login-bg-glow--2"></div>
    </div>

    <!-- Login card -->
    <div class="login-card">
      <!-- Brand section -->
      <div class="login-brand">
        <div class="login-logo-wrap">
          <img src="/images/logo/logo.png" alt="Logo" class="login-logo" />
        </div>
        <h1 class="login-title">FORCOME 知识库</h1>
        <p class="login-desc">企业协作知识管理平台</p>
      </div>

      <!-- Divider -->
      <div class="login-divider">
        <span class="login-divider-text">登录以继续</span>
      </div>

      <!-- H5 auto-login loading state -->
      <div v-if="h5Loading" class="login-loading">
        <div class="login-spinner">
          <div class="login-spinner-ring"></div>
        </div>
        <p class="login-loading-text">正在自动登录...</p>
      </div>

      <!-- Login actions -->
      <div v-else class="login-actions">
        <button
          class="login-btn"
          :disabled="isLoading"
          @click="handleDingTalkLogin"
        >
          <svg class="login-btn-icon" viewBox="0 0 1024 1024" width="22" height="22" fill="currentColor">
            <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm227.2 468.3s-89.8 72.4-124.4 101c-2 1.6-2.2 2-2.2 2l-0.2 0.6c0 0.2-0.2 0.8-0.2 1.6 0 2 1.4 5 4.4 8.8 15.2 19.6 76 99 76 99s5.8 8.4 3.4 13.2c-1.6 3-5 5-10.4 5H596c-5.4 0-11.8-2.6-18.4-7.8-10-7.8-54.8-57-54.8-57s-6.2-6.2-12.6-6.2c-3.4 0-6.8 1.6-9.6 6.4-8.6 14.6-24.8 39.4-37.4 55.4-5.2 6.6-14.2 14.8-29.6 14.8h-7.4c-8 0-11-5.4-11-8.2 0-2.2 1-4.8 4-8.8 0 0 73.6-95 73.6-95.2 2.2-3.2 3.4-6 3.4-8.2 0-3.2-2.2-5.4-4-6.8l-91-72.8c-3.2-2.6-4.2-5.4-4.2-7.4 0-4 3.6-8 10.2-8h90c0.8 0 3-0.2 3.6-0.2 5.2-0.6 7.6-4 9.2-6.4l52-78.2c3.4-5 7.6-7.4 11.2-7.4 3.2 0 6 2 7.2 5.8 0 0 21.8 67.2 23.4 72.8 0.6 2 2.4 4.6 6.8 4.6h95c6.6 0 10.4 4 10.4 8.2 0 2.4-1.2 5.2-5.2 8.4z"/>
          </svg>
          <span class="login-btn-text">钉钉扫码登录</span>
          <svg class="login-btn-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <p v-if="error" class="login-error">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.75v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z"/>
          </svg>
          {{ error }}
        </p>
      </div>

      <!-- Footer -->
      <p class="login-footer">使用企业钉钉账号安全登录</p>
    </div>
  </div>
</template>

<style scoped>
/* ===== Page container ===== */
.login-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Flex-fill inside layout-main, full width */
  flex: 1;
  min-width: 0;
  height: calc(100vh - var(--navbar-height));
  overflow: hidden;
}

/* ===== Background ===== */
.login-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
}

.login-bg-grain {
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
}

.login-bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0;
  transition: opacity 1.2s ease;
}

.login-bg-glow--1 {
  width: 400px;
  height: 400px;
  top: -120px;
  right: -80px;
  background: var(--c-accent);
  opacity: 0;
}

.login-bg-glow--2 {
  width: 300px;
  height: 300px;
  bottom: -100px;
  left: -60px;
  background: #0089ff;
  opacity: 0;
}

.is-mounted .login-bg-glow--1 {
  opacity: 0.06;
}

.is-mounted .login-bg-glow--2 {
  opacity: 0.05;
}

:global(.dark) .is-mounted .login-bg-glow--1 {
  opacity: 0.08;
}

:global(.dark) .is-mounted .login-bg-glow--2 {
  opacity: 0.06;
}

/* ===== Card ===== */
.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 380px;
  padding: 40px 36px 32px;
  border-radius: 16px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 6px 24px rgba(0, 0, 0, 0.06);

  /* Entrance animation */
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.is-mounted .login-card {
  opacity: 1;
  transform: translateY(0);
}

:global(.dark) .login-card {
  background: var(--c-bg-soft);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.2),
    0 6px 24px rgba(0, 0, 0, 0.25);
}

/* ===== Brand section ===== */
.login-brand {
  text-align: center;
  margin-bottom: 24px;
}

.login-logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 16px;
  border-radius: 14px;
  background: var(--c-bg-mute);
  border: 1px solid var(--c-border);

  /* Stagger entrance */
  opacity: 0;
  transform: scale(0.8);
  transition:
    opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.15s,
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.15s;
}

.is-mounted .login-logo-wrap {
  opacity: 1;
  transform: scale(1);
}

.login-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--c-text-1);
  margin: 0;
  line-height: 1.2;

  /* Stagger entrance */
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 0.4s ease 0.22s,
    transform 0.4s ease 0.22s;
}

.is-mounted .login-title {
  opacity: 1;
  transform: translateY(0);
}

.login-desc {
  font-size: 13px;
  color: var(--c-text-3);
  margin: 6px 0 0;
  letter-spacing: 0.02em;

  /* Stagger entrance */
  opacity: 0;
  transition: opacity 0.4s ease 0.3s;
}

.is-mounted .login-desc {
  opacity: 1;
}

/* ===== Divider ===== */
.login-divider {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 24px;
}

.login-divider::before,
.login-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--c-border);
}

.login-divider-text {
  padding: 0 12px;
  font-size: 12px;
  color: var(--c-text-4);
  white-space: nowrap;
  letter-spacing: 0.04em;
}

/* ===== Loading state ===== */
.login-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0 8px;
}

.login-spinner {
  width: 36px;
  height: 36px;
  margin-bottom: 14px;
}

.login-spinner-ring {
  width: 100%;
  height: 100%;
  border: 2.5px solid var(--c-border);
  border-top-color: #0089ff;
  border-radius: 50%;
  animation: login-spin 0.7s linear infinite;
}

@keyframes login-spin {
  to { transform: rotate(360deg); }
}

.login-loading-text {
  font-size: 13px;
  color: var(--c-text-3);
}

/* ===== Login button ===== */
.login-actions {
  /* Stagger entrance */
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 0.4s ease 0.38s,
    transform 0.4s ease 0.38s;
}

.is-mounted .login-actions {
  opacity: 1;
  transform: translateY(0);
}

.login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 20px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: #0089ff;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.2s ease,
    transform 0.15s ease,
    box-shadow 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 137, 255, 0.25);
}

.login-btn:hover {
  background: #0078e5;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 137, 255, 0.3);
}

.login-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(0, 137, 255, 0.2);
}

.login-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.login-btn-icon {
  flex-shrink: 0;
}

.login-btn-text {
  flex: 0 0 auto;
}

.login-btn-arrow {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.2s ease;
}

.login-btn:hover .login-btn-arrow {
  transform: translateX(2px);
  opacity: 1;
}

/* ===== Error message ===== */
.login-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--c-error);
  background: rgba(239, 68, 68, 0.06);
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.12);
}

:global(.dark) .login-error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
}

/* ===== Footer ===== */
.login-footer {
  text-align: center;
  font-size: 11px;
  color: var(--c-text-4);
  margin-top: 20px;
  letter-spacing: 0.02em;
}

/* ===== Mobile responsive ===== */
@media (max-width: 639px) {
  .login-page {
    padding: 0 16px;
  }

  .login-card {
    max-width: none;
    padding: 32px 24px 28px;
    border-radius: 14px;
  }
}

/* Small height screens - prevent card from being cut off */
@media (max-height: 560px) {
  .login-page {
    align-items: flex-start;
    padding-top: 24px;
    overflow-y: auto;
  }
}
</style>
