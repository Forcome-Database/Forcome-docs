export interface AuthUser {
  id: string
  name: string
  email: string
  avatarUrl?: string
  role: 'owner' | 'admin' | 'member'
}

export interface DingTalkConfig {
  enabled: boolean
  corpId?: string
  appKey?: string
  agentId?: string
}

export interface AuthResult {
  user: AuthUser
}
