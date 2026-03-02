/**
 * Docmost API 服务
 * 封装 Docmost Public Wiki API，提供空间、侧边栏、页面、搜索、AI 问答功能
 */

import type {
  DocmostSpace,
  DocmostSidebarNode,
  DocmostPage,
  DocmostSearchResult,
  DocmostAiStreamEvent,
  AiHistoryMessage,
} from '../types'
import { AppError } from './errors'

interface DocmostServiceConfig {
  baseUrl: string
}

/**
 * Docmost Public Wiki API 服务类
 */
export class DocmostService {
  private config: DocmostServiceConfig
  private abortController: AbortController | null = null

  constructor(config: DocmostServiceConfig) {
    this.config = config
  }

  private async post<T>(endpoint: string, body: Record<string, any> = {}): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw AppError.api(
        `Docmost API 错误: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
      )
    }

    const json = await response.json()
    // Docmost TransformHttpResponseInterceptor 会包装为 { data, success, status }
    return json.data !== undefined ? json.data : json
  }

  /**
   * 获取公开空间列表
   */
  async getSpaces(): Promise<DocmostSpace[]> {
    const result = await this.post<{ items: DocmostSpace[] }>('spaces')
    return result.items
  }

  /**
   * 获取空间侧边栏页面树
   */
  async getSidebar(spaceSlug: string): Promise<{
    space: { id: string; name: string; slug: string }
    items: DocmostSidebarNode[]
  }> {
    return this.post('sidebar', { spaceSlug })
  }

  /**
   * 获取页面内容
   */
  async getPage(slugId: string, format: 'html' | 'markdown' = 'html'): Promise<DocmostPage> {
    return this.post('page', { slugId, format })
  }

  /**
   * 搜索公开页面
   */
  async search(query: string, spaceSlug?: string, limit?: number): Promise<DocmostSearchResult[]> {
    const result = await this.post<{ items: DocmostSearchResult[] }>('search', {
      query,
      spaceSlug,
      limit,
    })
    return result.items
  }

  /**
   * AI 问答（SSE 流式响应）
   * @param query 用户问题
   * @param pageSlugId 当前页面 slugId（可选，用于上下文定位）
   * @param history 多轮对话历史（可选）
   */
  async *aiAnswers(query: string, pageSlugId?: string, history?: AiHistoryMessage[]): AsyncGenerator<DocmostAiStreamEvent> {
    this.abort()
    this.abortController = new AbortController()

    let response: Response

    try {
      const body: Record<string, any> = { query }
      if (pageSlugId) body.pageSlugId = pageSlugId
      if (history && history.length > 0) body.history = history

      response = await fetch(`${this.config.baseUrl}/ai/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      throw AppError.network('网络请求失败，请检查网络连接', error as Error)
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw AppError.api(
        `Docmost AI API 错误: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw AppError.api('无法读取响应数据')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          if (buffer.trim()) {
            const event = this.parseSSELine(buffer)
            if (event) yield event
          }
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const event = this.parseSSELine(line)
          if (event) yield event
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      throw AppError.from(error)
    } finally {
      reader.releaseLock()
    }
  }

  private parseSSELine(line: string): DocmostAiStreamEvent | null {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return null

    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6)
      if (data === '[DONE]') return null

      try {
        return JSON.parse(data) as DocmostAiStreamEvent
      } catch {
        return null
      }
    }

    return null
  }

  /**
   * 取消当前请求
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * 检查服务是否已配置
   */
  isConfigured(): boolean {
    return !!this.config.baseUrl
  }
}

/**
 * 创建 Docmost 服务实例
 */
export function createDocmostService(): DocmostService | null {
  if (typeof window === 'undefined') {
    return null
  }

  const baseUrl = import.meta.env.VITE_DOCMOST_API_URL as string | undefined

  if (!baseUrl) {
    console.warn('[DocmostService] 未配置 VITE_DOCMOST_API_URL 环境变量')
    return null
  }

  return new DocmostService({ baseUrl })
}
