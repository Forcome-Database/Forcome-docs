/**
 * 错误处理服务
 * 提供统一的错误类型和错误处理工具
 */

import { ErrorType, type AppError as IAppError } from '../types'

/**
 * 应用错误类
 * 统一的错误处理基类，包含错误类型、消息和原始错误
 */
export class AppError extends Error implements IAppError {
  readonly type: ErrorType
  readonly cause?: Error

  constructor(type: ErrorType, message: string, cause?: Error) {
    super(message)
    this.name = 'AppError'
    this.type = type
    this.cause = cause

    // 保持正确的原型链
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /**
   * 创建网络错误
   */
  static network(message: string = '网络连接失败，请检查网络设置', cause?: Error): AppError {
    return new AppError(ErrorType.Network, message, cause)
  }

  /**
   * 创建 API 错误
   */
  static api(message: string = 'API 请求失败，请稍后重试', cause?: Error): AppError {
    return new AppError(ErrorType.Api, message, cause)
  }

  /**
   * 创建存储错误
   */
  static storage(message: string = '本地存储操作失败', cause?: Error): AppError {
    return new AppError(ErrorType.Storage, message, cause)
  }

  /**
   * 创建未知错误
   */
  static unknown(message: string = '发生未知错误', cause?: Error): AppError {
    return new AppError(ErrorType.Unknown, message, cause)
  }

  /**
   * 从任意错误创建 AppError
   */
  static from(error: unknown): AppError {
    if (error instanceof AppError) {
      return error
    }

    if (error instanceof Error) {
      // 检测网络错误
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return AppError.network('网络请求失败', error)
      }
      return AppError.unknown(error.message, error)
    }

    if (typeof error === 'string') {
      return AppError.unknown(error)
    }

    return AppError.unknown('发生未知错误')
  }

  /**
   * 获取用户友好的错误消息
   */
  getUserMessage(): string {
    switch (this.type) {
      case ErrorType.Network:
        return '网络连接失败，请检查网络设置后重试'
      case ErrorType.Api:
        return 'API 服务暂时不可用，请稍后重试'
      case ErrorType.Storage:
        return '本地存储不可用，部分功能可能受限'
      case ErrorType.Unknown:
      default:
        return this.message || '发生未知错误，请刷新页面重试'
    }
  }

  /**
   * 转换为普通对象
   */
  toJSON(): IAppError {
    return {
      type: this.type,
      message: this.message,
      cause: this.cause
    }
  }
}

/**
 * 错误处理工具函数
 */

/**
 * 安全执行异步操作，捕获错误并转换为 AppError
 * 
 * @example
 * ```ts
 * const [result, error] = await tryCatch(async () => {
 *   return await fetchData()
 * })
 * 
 * if (error) {
 *   console.error(error.getUserMessage())
 * }
 * ```
 */
export async function tryCatch<T>(
  fn: () => Promise<T>
): Promise<[T, null] | [null, AppError]> {
  try {
    const result = await fn()
    return [result, null]
  } catch (error) {
    return [null, AppError.from(error)]
  }
}

/**
 * 安全执行同步操作
 */
export function tryCatchSync<T>(
  fn: () => T
): [T, null] | [null, AppError] {
  try {
    const result = fn()
    return [result, null]
  } catch (error) {
    return [null, AppError.from(error)]
  }
}

/**
 * 判断是否为 AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * 获取错误的用户友好消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.getUserMessage()
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return '发生未知错误'
}
