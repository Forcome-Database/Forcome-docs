/**
 * AI 问答工具函数
 * 提供 Dify 模式配置检测和快捷键修饰符获取
 */

import type { DifyMode } from '../types'

/**
 * 获取 Dify 模式配置
 */
export function getDifyMode(): DifyMode {
  const mode = import.meta.env.VITE_DIFY_MODE as string
  return mode === 'embed' ? 'embed' : 'api'
}

/**
 * 获取 Dify 嵌入链接 URL
 */
export function getDifyEmbedUrl(): string {
  return import.meta.env.VITE_DIFY_EMBED_URL as string || ''
}

/**
 * 检查嵌入模式是否已配置
 */
export function isEmbedConfigured(): boolean {
  return getDifyMode() === 'embed' && !!getDifyEmbedUrl()
}

/**
 * 获取操作系统对应的快捷键修饰符
 */
export function getAIChatModifierKey(): string {
  if (typeof navigator === 'undefined') return '⌘'
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  return isMac ? '⌘' : 'Ctrl'
}
