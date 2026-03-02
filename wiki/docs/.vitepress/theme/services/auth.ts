import type { AuthUser, DingTalkConfig, AuthResult } from '../types/auth'

export class AuthService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async post<T>(endpoint: string, body: Record<string, any> = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.message || `Auth API error: ${response.status}`)
    }

    const json = await response.json()
    return json.data !== undefined ? json.data : json
  }

  async getDingTalkConfig(): Promise<DingTalkConfig> {
    return this.post<DingTalkConfig>('auth/dingtalk/config')
  }

  async dingtalkCallback(authCode: string): Promise<AuthResult> {
    return this.post<AuthResult>('auth/dingtalk/callback', { authCode })
  }

  async dingtalkH5Login(code: string): Promise<AuthResult> {
    return this.post<AuthResult>('auth/dingtalk/h5-login', { code })
  }

  async getUserInfo(): Promise<AuthUser> {
    return this.post<AuthUser>('auth/dingtalk/user-info')
  }

  async logout(): Promise<void> {
    await this.post('auth/logout')
  }
}

let authServiceInstance: AuthService | null = null

export function getAuthService(): AuthService | null {
  if (authServiceInstance) return authServiceInstance

  const docmostApiUrl = import.meta.env.VITE_DOCMOST_API_URL as string
  if (!docmostApiUrl) return null

  const baseUrl = docmostApiUrl.replace(/\/public-wiki\/?$/, '')
  authServiceInstance = new AuthService(baseUrl)
  return authServiceInstance
}
