/**
 * 本地存储服务
 * 封装 localStorage 操作，提供类型安全的 get/set/remove 方法
 * 包含错误处理，确保存储失败时不影响核心功能
 */

import { StorageKey, ErrorType } from '../types'

/** 存储错误类 */
export class StorageError extends Error {
  readonly type = ErrorType.Storage
  readonly cause?: Error

  constructor(message: string, cause?: Error) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

/**
 * 检查 localStorage 是否可用
 * 某些浏览器在隐私模式下可能禁用 localStorage
 */
function isStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__'
    window.localStorage.setItem(testKey, testKey)
    window.localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

/** 存储是否可用的缓存标志 */
let storageAvailable: boolean | null = null

/**
 * 获取存储可用性（带缓存）
 */
function checkStorageAvailable(): boolean {
  if (storageAvailable === null) {
    storageAvailable = typeof window !== 'undefined' && isStorageAvailable()
  }
  return storageAvailable
}

/**
 * 存储服务类
 * 提供类型安全的 localStorage 操作
 */
export class StorageService {
  /**
   * 从 localStorage 获取数据
   * @param key 存储键
   * @returns 解析后的数据，如果不存在或解析失败则返回 null
   */
  get<T>(key: StorageKey | string): T | null {
    if (!checkStorageAvailable()) {
      return null
    }

    try {
      const item = window.localStorage.getItem(key)
      if (item === null) {
        return null
      }
      return JSON.parse(item) as T
    } catch (error) {
      // JSON 解析失败时，尝试返回原始字符串
      console.warn(`[StorageService] 解析存储数据失败: ${key}`, error)
      return null
    }
  }

  /**
   * 将数据存储到 localStorage
   * @param key 存储键
   * @param value 要存储的数据
   * @returns 是否存储成功
   */
  set<T>(key: StorageKey | string, value: T): boolean {
    if (!checkStorageAvailable()) {
      console.warn('[StorageService] localStorage 不可用')
      return false
    }

    try {
      const serialized = JSON.stringify(value)
      window.localStorage.setItem(key, serialized)
      return true
    } catch (error) {
      // 可能是存储空间已满或其他错误
      console.error(`[StorageService] 存储数据失败: ${key}`, error)
      return false
    }
  }

  /**
   * 从 localStorage 移除数据
   * @param key 存储键
   * @returns 是否移除成功
   */
  remove(key: StorageKey | string): boolean {
    if (!checkStorageAvailable()) {
      return false
    }

    try {
      window.localStorage.removeItem(key)
      return true
    } catch (error) {
      console.error(`[StorageService] 移除数据失败: ${key}`, error)
      return false
    }
  }

  /**
   * 检查键是否存在
   * @param key 存储键
   */
  has(key: StorageKey | string): boolean {
    if (!checkStorageAvailable()) {
      return false
    }

    try {
      return window.localStorage.getItem(key) !== null
    } catch {
      return false
    }
  }

  /**
   * 清除所有应用相关的存储数据
   * 只清除以 'cursor-docs-' 开头的键
   */
  clearAll(): boolean {
    if (!checkStorageAvailable()) {
      return false
    }

    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (key?.startsWith('cursor-docs-')) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => window.localStorage.removeItem(key))
      return true
    } catch (error) {
      console.error('[StorageService] 清除数据失败', error)
      return false
    }
  }

  /**
   * 检查存储是否可用
   */
  isAvailable(): boolean {
    return checkStorageAvailable()
  }
}

/** 默认存储服务实例 */
export const storage = new StorageService()
