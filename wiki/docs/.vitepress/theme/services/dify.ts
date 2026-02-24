/**
 * Dify API 服务
 * 封装 Dify 知识库问答 API，支持 SSE 流式响应
 * 
 * 需求: 6.3, 6.4, 6.11
 */

import type { DifyConfig, DifyStreamEvent, DifyChatRequest } from '../types'
import { AppError } from './errors'

/**
 * Dify API 服务类
 * 提供与 Dify 知识库的交互能力，支持流式响应
 */
export class DifyService {
  private config: DifyConfig
  private abortController: AbortController | null = null

  constructor(config: DifyConfig) {
    this.config = config
  }

  /**
   * 发送聊天消息（流式响应）
   * 使用 AsyncGenerator 实现 SSE 流式解析
   * 
   * @param query 用户问题
   * @param conversationId 对话 ID（可选，用于多轮对话）
   * @param userId 用户标识
   * @yields DifyStreamEvent 流式响应事件
   */
  async *sendMessage(
    query: string,
    conversationId?: string,
    userId: string = 'anonymous'
  ): AsyncGenerator<DifyStreamEvent> {
    // 取消之前的请求
    this.abort()
    this.abortController = new AbortController()

    const requestBody: DifyChatRequest = {
      inputs: {},
      query,
      response_mode: 'streaming',
      user: userId
    }

    // 如果有对话 ID，添加到请求中
    if (conversationId) {
      requestBody.conversation_id = conversationId
    }

    let response: Response

    try {
      response = await fetch(`${this.config.apiBase}/chat-messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal
      })
    } catch (error) {
      // 处理请求被取消的情况
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      throw AppError.network('网络请求失败，请检查网络连接', error as Error)
    }

    // 检查响应状态
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw AppError.api(
        `Dify API 错误: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
      )
    }

    // 获取响应体读取器
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
          // 处理缓冲区中剩余的数据
          if (buffer.trim()) {
            const event = this.parseSSELine(buffer)
            if (event) {
              yield event
            }
          }
          break
        }

        // 解码并追加到缓冲区
        buffer += decoder.decode(value, { stream: true })
        
        // 按行分割处理
        const lines = buffer.split('\n')
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || ''

        // 处理完整的行
        for (const line of lines) {
          const event = this.parseSSELine(line)
          if (event) {
            yield event
          }
        }
      }
    } catch (error) {
      // 处理请求被取消的情况
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      throw AppError.from(error)
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 解析 SSE 行数据
   * @param line SSE 数据行
   * @returns 解析后的事件对象，如果无法解析则返回 null
   */
  private parseSSELine(line: string): DifyStreamEvent | null {
    const trimmedLine = line.trim()
    
    // 跳过空行和注释
    if (!trimmedLine || trimmedLine.startsWith(':')) {
      return null
    }

    // 解析 data: 前缀的行
    if (trimmedLine.startsWith('data: ')) {
      const data = trimmedLine.slice(6)
      
      // 检查是否为结束标记
      if (data === '[DONE]') {
        return null
      }

      try {
        return JSON.parse(data) as DifyStreamEvent
      } catch (error) {
        console.warn('[DifyService] SSE 数据解析失败:', data, error)
        return null
      }
    }

    // 处理 event: 前缀的行（Dify 可能发送事件类型）
    if (trimmedLine.startsWith('event: ')) {
      // 事件类型行，通常后面跟着 data 行，这里不单独处理
      return null
    }

    return null
  }

  /**
   * 取消当前请求
   * 用于用户中断或组件卸载时清理
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
    return !!(this.config.apiBase && this.config.apiKey)
  }

  /**
   * 获取当前配置（不包含敏感信息）
   */
  getConfigInfo(): { apiBase: string; hasApiKey: boolean } {
    return {
      apiBase: this.config.apiBase,
      hasApiKey: !!this.config.apiKey
    }
  }
}

/**
 * 创建 Dify 服务实例
 * 从环境变量读取配置
 */
export function createDifyService(): DifyService | null {
  // 检查是否在浏览器环境
  if (typeof window === 'undefined') {
    return null
  }

  const apiBase = import.meta.env.VITE_DIFY_API_BASE as string | undefined
  const apiKey = import.meta.env.VITE_DIFY_API_KEY as string | undefined

  if (!apiBase || !apiKey) {
    console.warn('[DifyService] 未配置 Dify API 环境变量')
    return null
  }

  return new DifyService({ apiBase, apiKey })
}
