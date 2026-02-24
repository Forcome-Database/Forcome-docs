/**
 * 响应式存储 Composable
 * 提供 Vue 响应式的 localStorage 操作
 * 支持跨标签页同步和默认值
 */

import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { storage, StorageService } from '../services/storage'
import { StorageKey } from '../types'

/**
 * useStorage 配置选项
 */
export interface UseStorageOptions<T> {
  /** 默认值，当存储中没有数据时使用 */
  defaultValue?: T
  /** 是否监听其他标签页的存储变化 */
  listenToStorageEvents?: boolean
  /** 自定义序列化函数 */
  serializer?: {
    read: (raw: string) => T
    write: (value: T) => string
  }
}

/**
 * 响应式 localStorage Hook
 * 
 * @param key 存储键
 * @param options 配置选项
 * @returns 响应式的存储值和操作方法
 * 
 * @example
 * ```ts
 * const { value, set, remove } = useStorage(StorageKey.Theme, {
 *   defaultValue: 'auto'
 * })
 * 
 * // 读取值
 * console.log(value.value)
 * 
 * // 设置值（自动同步到 localStorage）
 * value.value = 'dark'
 * 
 * // 或使用 set 方法
 * set('light')
 * 
 * // 移除
 * remove()
 * ```
 */
export function useStorage<T>(
  key: StorageKey | string,
  options: UseStorageOptions<T> = {}
): {
  value: Ref<T | null>
  set: (newValue: T) => boolean
  remove: () => boolean
  refresh: () => void
} {
  const {
    defaultValue = null as T | null,
    listenToStorageEvents = true
  } = options

  // 初始化响应式值
  const value = ref<T | null>(defaultValue) as Ref<T | null>

  // 从存储读取初始值
  const readFromStorage = () => {
    const stored = storage.get<T>(key)
    value.value = stored !== null ? stored : defaultValue
  }

  // 写入存储
  const writeToStorage = (newValue: T | null): boolean => {
    if (newValue === null) {
      return storage.remove(key)
    }
    return storage.set(key, newValue)
  }

  // 设置值
  const set = (newValue: T): boolean => {
    value.value = newValue
    return writeToStorage(newValue)
  }

  // 移除值
  const remove = (): boolean => {
    value.value = defaultValue
    return storage.remove(key)
  }

  // 刷新（从存储重新读取）
  const refresh = () => {
    readFromStorage()
  }

  // 监听值变化，自动同步到存储
  watch(
    value,
    (newValue) => {
      writeToStorage(newValue)
    },
    { deep: true }
  )

  // 处理跨标签页存储事件
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === key && event.newValue !== null) {
      try {
        value.value = JSON.parse(event.newValue) as T
      } catch {
        // 解析失败时忽略
      }
    } else if (event.key === key && event.newValue === null) {
      value.value = defaultValue
    }
  }

  onMounted(() => {
    // 读取初始值
    readFromStorage()

    // 监听存储事件（跨标签页同步）
    if (listenToStorageEvents && typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageEvent)
    }
  })

  onUnmounted(() => {
    if (listenToStorageEvents && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageEvent)
    }
  })

  return {
    value,
    set,
    remove,
    refresh
  }
}

/**
 * 简化版 useStorage，直接返回响应式值
 * 适用于简单场景
 * 
 * @example
 * ```ts
 * const theme = useStorageValue(StorageKey.Theme, 'auto')
 * theme.value = 'dark' // 自动同步到 localStorage
 * ```
 */
export function useStorageValue<T>(
  key: StorageKey | string,
  defaultValue: T
): Ref<T> {
  const { value } = useStorage<T>(key, { defaultValue })
  return value as Ref<T>
}

/**
 * 获取存储服务实例
 * 用于非响应式场景
 */
export function useStorageService(): StorageService {
  return storage
}
