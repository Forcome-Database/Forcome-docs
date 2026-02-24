/**
 * 主题状态管理 Composable
 * 提供主题偏好状态、系统主题检测、主题切换功能
 * 支持 localStorage 持久化和跨标签页同步
 * 
 * 需求: 7.1-7.7
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { storage } from '../services/storage'
import { StorageKey, type ThemeMode, type ResolvedTheme } from '../types'

/** 系统主题媒体查询 */
const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)'

/**
 * 主题状态管理 Hook
 * 
 * @returns 主题状态和操作方法
 * 
 * @example
 * ```ts
 * const { isDark, toggleTheme, setTheme } = useTheme()
 * 
 * // 检查当前是否为深色模式
 * if (isDark.value) {
 *   console.log('当前为深色模式')
 * }
 * 
 * // 切换主题
 * toggleTheme()
 * 
 * // 设置特定主题
 * setTheme('dark')
 * setTheme('light')
 * setTheme('auto') // 跟随系统
 * ```
 */
export function useTheme() {
  // 用户主题偏好（light/dark/auto）
  const preference = ref<ThemeMode>('auto')
  
  // 系统是否为深色模式
  const systemDark = ref(false)
  
  // 媒体查询实例
  let mediaQuery: MediaQueryList | null = null

  /**
   * 实际应用的主题（计算属性）
   * 当 preference 为 'auto' 时，跟随系统主题
   */
  const resolved = computed<ResolvedTheme>(() => {
    if (preference.value === 'auto') {
      return systemDark.value ? 'dark' : 'light'
    }
    return preference.value
  })

  /**
   * 是否为深色模式（便捷计算属性）
   */
  const isDark = computed(() => resolved.value === 'dark')

  /**
   * 切换主题
   * - 如果当前是 auto 模式，切换到与当前系统相反的主题
   * - 如果当前是 light/dark，直接切换
   */
  const toggleTheme = () => {
    if (preference.value === 'auto') {
      // auto 模式下，切换到与当前系统相反的主题
      preference.value = systemDark.value ? 'light' : 'dark'
    } else {
      // 直接切换 light/dark
      preference.value = preference.value === 'dark' ? 'light' : 'dark'
    }
  }

  /**
   * 设置主题
   * @param theme 主题模式
   */
  const setTheme = (theme: ThemeMode) => {
    preference.value = theme
  }

  /**
   * 重置为自动模式（跟随系统）
   */
  const resetToAuto = () => {
    preference.value = 'auto'
  }

  /**
   * 应用主题到 DOM
   * 添加/移除 html 元素的 dark 类
   */
  const applyThemeToDOM = () => {
    if (typeof document === 'undefined') return

    const html = document.documentElement

    // 添加过渡类，实现平滑切换（需求 7.6）
    html.classList.add('theme-transition')

    // 应用主题类
    if (isDark.value) {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }

    // 过渡完成后移除过渡类，避免影响其他动画
    requestAnimationFrame(() => {
      // 使用 setTimeout 确保过渡动画完成
      setTimeout(() => {
        html.classList.remove('theme-transition')
      }, 200) // 与 --transition-normal 保持一致
    })
  }

  /**
   * 保存主题偏好到 localStorage（需求 7.2）
   */
  const savePreference = () => {
    storage.set(StorageKey.Theme, preference.value)
  }

  /**
   * 从 localStorage 加载主题偏好（需求 7.3）
   */
  const loadPreference = () => {
    const saved = storage.get<ThemeMode>(StorageKey.Theme)
    if (saved && ['light', 'dark', 'auto'].includes(saved)) {
      preference.value = saved
    }
  }

  /**
   * 检测系统主题偏好（需求 7.4）
   */
  const detectSystemTheme = () => {
    if (typeof window === 'undefined') return

    mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY)
    systemDark.value = mediaQuery.matches
  }

  /**
   * 处理系统主题变化（需求 7.7）
   */
  const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    systemDark.value = event.matches
  }

  /**
   * 处理跨标签页存储变化
   */
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === StorageKey.Theme && event.newValue) {
      try {
        const newTheme = JSON.parse(event.newValue) as ThemeMode
        if (['light', 'dark', 'auto'].includes(newTheme)) {
          preference.value = newTheme
        }
      } catch {
        // 解析失败时忽略
      }
    }
  }

  // 监听主题偏好变化，自动保存和应用
  watch(preference, () => {
    savePreference()
    applyThemeToDOM()
  })

  // 监听系统主题变化，当 preference 为 auto 时自动更新
  watch(systemDark, () => {
    if (preference.value === 'auto') {
      applyThemeToDOM()
    }
  })

  // 组件挂载时初始化
  onMounted(() => {
    // 检测系统主题
    detectSystemTheme()

    // 加载保存的偏好
    loadPreference()

    // 应用主题到 DOM
    applyThemeToDOM()

    // 监听系统主题变化
    if (mediaQuery) {
      mediaQuery.addEventListener('change', handleSystemThemeChange)
    }

    // 监听跨标签页存储变化
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange)
    }
  })

  // 组件卸载时清理
  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageChange)
    }
  })

  return {
    // 状态
    /** 用户主题偏好 */
    preference,
    /** 系统是否为深色模式 */
    systemDark,
    /** 实际应用的主题 */
    resolved,
    /** 是否为深色模式 */
    isDark,

    // 方法
    /** 切换主题 */
    toggleTheme,
    /** 设置主题 */
    setTheme,
    /** 重置为自动模式 */
    resetToAuto
  }
}

/**
 * 在 SSR 环境下安全初始化主题
 * 用于防止页面闪烁（FOUC）
 * 
 * 在 head 中注入此脚本可以在 HTML 解析前应用主题
 */
export const themeInitScript = `
;(function() {
  const storageKey = '${StorageKey.Theme}'
  const darkClass = 'dark'
  
  try {
    const stored = localStorage.getItem(storageKey)
    const preference = stored ? JSON.parse(stored) : 'auto'
    
    let isDark = false
    if (preference === 'dark') {
      isDark = true
    } else if (preference === 'auto') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    
    if (isDark) {
      document.documentElement.classList.add(darkClass)
    }
  } catch (e) {
    // 忽略错误
  }
})()
`
