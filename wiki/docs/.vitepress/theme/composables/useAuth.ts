import { ref, computed } from 'vue'
import type { AuthUser, DingTalkConfig } from '../types/auth'
import { getAuthService } from '../services/auth'

const currentUser = ref<AuthUser | null>(null)
const dingtalkConfig = ref<DingTalkConfig | null>(null)
const isLoading = ref(false)
const isInitialized = ref(false)

function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${name}=`))
}

function isInDingTalk(): boolean {
  if (typeof navigator === 'undefined') return false
  return /DingTalk/i.test(navigator.userAgent)
}

export function useAuth() {
  const isAuthenticated = computed(() => !!currentUser.value)
  const isAdmin = computed(
    () => currentUser.value?.role === 'admin' || currentUser.value?.role === 'owner',
  )

  async function loadDingTalkConfig(): Promise<DingTalkConfig | null> {
    if (dingtalkConfig.value) return dingtalkConfig.value
    const authService = getAuthService()
    if (!authService) return null
    try {
      dingtalkConfig.value = await authService.getDingTalkConfig()
      return dingtalkConfig.value
    } catch (err) {
      console.warn('[Auth] Failed to load DingTalk config:', err)
      return null
    }
  }

  async function fetchUserInfo(): Promise<boolean> {
    const authService = getAuthService()
    if (!authService) return false
    try {
      currentUser.value = await authService.getUserInfo()
      return true
    } catch {
      currentUser.value = null
      return false
    }
  }

  async function initAuth(): Promise<void> {
    if (isInitialized.value) return
    isLoading.value = true
    try {
      if (hasCookie('authToken')) {
        await fetchUserInfo()
      }
    } finally {
      isLoading.value = false
      isInitialized.value = true
    }
  }

  async function loginWithDingTalkCode(authCode: string): Promise<boolean> {
    const authService = getAuthService()
    if (!authService) return false
    try {
      isLoading.value = true
      const result = await authService.dingtalkCallback(authCode)
      currentUser.value = result.user
      return true
    } catch (err) {
      console.error('[Auth] DingTalk callback failed:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function loginWithH5Code(code: string): Promise<boolean> {
    const authService = getAuthService()
    if (!authService) return false
    try {
      isLoading.value = true
      const result = await authService.dingtalkH5Login(code)
      currentUser.value = result.user
      return true
    } catch (err) {
      console.error('[Auth] H5 login failed:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function logout(): Promise<void> {
    const authService = getAuthService()
    if (authService) {
      try {
        await authService.logout()
      } catch {
        // ignore logout errors
      }
    }
    currentUser.value = null
    if (typeof document !== 'undefined') {
      document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
  }

  return {
    currentUser,
    isAuthenticated,
    isAdmin,
    isLoading,
    isInitialized,
    dingtalkConfig,
    initAuth,
    loadDingTalkConfig,
    fetchUserInfo,
    loginWithDingTalkCode,
    loginWithH5Code,
    logout,
    isInDingTalk,
    hasCookie,
  }
}
