/// <reference types="vite/client" />

/**
 * Vite 环境变量类型声明
 */
interface ImportMetaEnv {
  /** Dify 模式：api 或 embed */
  readonly VITE_DIFY_MODE?: 'api' | 'embed'
  /** Dify API 基础 URL（api 模式） */
  readonly VITE_DIFY_API_BASE?: string
  /** Dify API 密钥（api 模式） */
  readonly VITE_DIFY_API_KEY?: string
  /** Dify 嵌入链接 URL（embed 模式） */
  readonly VITE_DIFY_EMBED_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Vite define 注入的版本号 */
declare const __APP_VERSION__: string
