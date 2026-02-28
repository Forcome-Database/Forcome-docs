/**
 * 类型定义
 * Cursor 风格文档平台
 * 
 * 包含：配置类型、导航类型、AI 问答类型、搜索类型、主题类型、布局类型、存储类型
 */

// ===== 存储类型 =====

/** localStorage 存储键枚举 */
export enum StorageKey {
  /** 主题偏好 */
  Theme = 'cursor-docs-theme',
  /** 侧边栏宽度 */
  SidebarWidth = 'cursor-docs-sidebar-width',
  /** 语言偏好 */
  Language = 'cursor-docs-language',
  /** AI 对话历史 */
  ChatHistory = 'cursor-docs-chat-history',
  /** 对话 ID */
  ConversationId = 'cursor-docs-conversation-id'
}

/** 存储的聊天历史 */
export interface StoredChatHistory {
  /** 对话 ID */
  conversationId: string
  /** 消息列表 */
  messages: ChatMessage[]
  /** 更新时间戳 */
  updatedAt: number
}

// ===== 配置类型 =====

/** Dify 模式类型 */
export type DifyMode = 'api' | 'embed'

/** Dify API 配置 */
export interface DifyConfig {
  /** 模式：api 或 embed */
  mode: DifyMode
  /** API 基础 URL（api 模式） */
  apiBase: string
  /** API 密钥（api 模式，从环境变量读取） */
  apiKey: string
  /** 嵌入链接 URL（embed 模式） */
  embedUrl: string
  /** 知识库 ID（可选） */
  knowledgeBaseId?: string
}

/** 多语言配置 */
export interface LocaleConfig {
  /** 语言代码 */
  code: string
  /** 语言名称 */
  name: string
  /** 路由前缀 */
  path: string
}

/** VitePress 站点配置扩展 */
export interface SiteConfig {
  /** Dify API 配置 */
  dify?: DifyConfig
  /** 支持的语言列表 */
  locales?: LocaleConfig[]
}

// ===== 导航类型 =====

/** 导航项 */
export interface NavItem {
  /** 显示文本 */
  text: string
  /** 链接地址 */
  link?: string
  /** 子导航项 */
  items?: NavItem[]
  /** 激活匹配规则 */
  activeMatch?: string
}

/** 侧边栏项 */
export interface SidebarItem {
  /** 显示文本 */
  text: string
  /** 链接地址 */
  link?: string
  /** 子项 */
  items?: SidebarItem[]
  /** 是否折叠 */
  collapsed?: boolean
}

/** 侧边栏路由配置（按路径分组） */
export interface SidebarRouteConfig {
  [path: string]: SidebarItem[]
}

// ===== AI 问答类型 =====

/** 消息角色 */
export type MessageRole = 'user' | 'assistant'

/** 聊天消息附带的图片 */
export interface ChatMessageImage {
  /** 唯一 ID */
  id: string
  /** 本地预览 URL（blob URL，不持久化） */
  previewUrl: string
  /** MIME 类型 */
  mimeType: string
}

/** 聊天消息 */
export interface ChatMessage {
  /** 消息 ID */
  id: string
  /** 角色 */
  role: MessageRole
  /** 消息内容 */
  content: string
  /** 时间戳 */
  timestamp: number
  /** 是否正在流式输出 */
  isStreaming?: boolean
  /** 附带的图片列表 */
  images?: ChatMessageImage[]
}

/** 对话状态 */
export interface ConversationState {
  /** 对话 ID */
  conversationId: string | null
  /** 消息列表 */
  messages: ChatMessage[]
  /** 是否加载中 */
  isLoading: boolean
  /** 错误信息 */
  error: string | null
}

/** Dify 聊天请求参数 */
export interface DifyChatRequest {
  /** 输入参数 */
  inputs: Record<string, string>
  /** 用户问题 */
  query: string
  /** 响应模式 */
  response_mode: 'streaming' | 'blocking'
  /** 对话 ID */
  conversation_id?: string
  /** 用户标识 */
  user: string
}

/** Dify 流式响应事件类型 */
export type DifyEventType = 'message' | 'agent_message' | 'agent_thought' | 'message_end' | 'error'

/** Dify 流式响应事件 */
export interface DifyStreamEvent {
  /** 事件类型 */
  event: DifyEventType
  /** 消息 ID */
  message_id?: string
  /** 对话 ID */
  conversation_id?: string
  /** 回答内容 */
  answer?: string
  /** 创建时间 */
  created_at?: number
}

// ===== 搜索类型 =====

/** 搜索结果 */
export interface SearchResult {
  /** 页面标题 */
  title: string
  /** 页面链接 */
  link: string
  /** 匹配内容摘要 */
  content: string
  /** 高亮后的匹配内容 */
  matchedContent: string
}

/** 搜索状态 */
export interface SearchState {
  /** 搜索关键词 */
  query: string
  /** 搜索结果列表 */
  results: SearchResult[]
  /** 当前选中索引 */
  selectedIndex: number
  /** 是否加载中 */
  isLoading: boolean
  /** 搜索框是否打开 */
  isOpen: boolean
}

// ===== 主题类型 =====

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'auto'

/** 解析后的主题 */
export type ResolvedTheme = 'light' | 'dark'

/** 主题状态 */
export interface ThemeState {
  /** 用户选择的主题偏好 */
  preference: ThemeMode
  /** 实际应用的主题 */
  resolved: ResolvedTheme
}

// ===== 布局类型 =====

/** 侧边栏状态 */
export interface SidebarState {
  /** 侧边栏宽度（px） */
  width: number
  /** 是否折叠（移动端） */
  isCollapsed: boolean
  /** 是否正在拖拽 */
  isDragging: boolean
  /** 是否打开（移动端抽屉） */
  isOpen: boolean
}

/** 侧边栏配置常量 */
export interface SidebarSizeConfig {
  /** 默认宽度 */
  defaultWidth: number
  /** 最小宽度 */
  minWidth: number
  /** 最大宽度 */
  maxWidth: number
}

/** 布局状态 */
export interface LayoutState {
  /** 移动端侧边栏状态 */
  isSidebarOpen: boolean
  /** 搜索模态框状态 */
  isSearchOpen: boolean
  /** AI 问答面板状态 */
  isAIChatOpen: boolean
  /** 侧边栏宽度 */
  sidebarWidth: number
}

/** 布局提供给子组件的注入接口 */
export interface LayoutProvide {
  /** 切换侧边栏 */
  toggleSidebar: () => void
  /** 切换搜索框 */
  toggleSearch: () => void
  /** 切换 AI 问答面板 */
  toggleAIChat: () => void
  /** 侧边栏宽度 */
  sidebarWidth: number
  /** 设置侧边栏宽度 */
  setSidebarWidth: (width: number) => void
}

// ===== 错误处理类型 =====

/** 错误类型枚举 */
export enum ErrorType {
  /** 网络错误 */
  Network = 'NETWORK_ERROR',
  /** API 错误 */
  Api = 'API_ERROR',
  /** 存储错误 */
  Storage = 'STORAGE_ERROR',
  /** 未知错误 */
  Unknown = 'UNKNOWN_ERROR'
}

/** 应用错误接口 */
export interface AppError {
  /** 错误类型 */
  type: ErrorType
  /** 错误消息 */
  message: string
  /** 原始错误 */
  cause?: Error
}

// ===== Docmost 集成类型 =====

/** Docmost 空间 */
export interface DocmostSpace {
  id: string
  name: string
  slug: string
  description?: string
  hasDirectories?: boolean
}

/** Docmost 目录 */
export interface DocmostDirectory {
  id: string
  name: string
  slug: string
  icon?: string
  position: string
}

/** Docmost 侧边栏页面节点 */
export interface DocmostSidebarNode {
  nodeType?: 'topic' | 'page'
  id: string
  name?: string
  slugId?: string
  title?: string
  icon?: string
  position: string
  hasChildren?: boolean
  children: DocmostSidebarNode[]
}

/** Docmost 页面 */
export interface DocmostPage {
  id: string
  slugId: string
  title: string
  icon?: string
  content: string
  breadcrumbs?: { id: string; title: string; slugId: string }[]
  spaceSlug: string
  spaceName: string
  updatedAt: string
  createdAt: string
  creator?: { id: string; name: string; avatarUrl?: string }
}

/** Docmost 搜索结果项 */
export interface DocmostSearchResult {
  id: string
  slugId: string
  title: string
  icon?: string
  highlight?: string
  spaceSlug?: string
  space?: { id: string; name: string; slug: string }
}

/** Docmost AI 流式事件 */
export interface DocmostAiStreamEvent {
  sources?: { title: string; slugId: string; spaceSlug: string }[]
  content?: string
  error?: string
}

// ===== 组件 Props 类型 =====

/** NavBar 组件事件 */
export interface NavBarEmits {
  (e: 'toggle-sidebar'): void
  (e: 'open-search'): void
}

/** SideBar 组件 Props */
export interface SideBarProps {
  /** 侧边栏宽度 */
  width: number
  /** 移动端打开状态 */
  isOpen: boolean
}

/** SideBar 组件事件 */
export interface SideBarEmits {
  (e: 'update:width', width: number): void
  (e: 'close'): void
}

/** SearchModal 组件事件 */
export interface SearchModalEmits {
  (e: 'close'): void
}

/** AIChat 组件事件 */
export interface AIChatEmits {
  (e: 'close'): void
}

/** AIChatMessage 组件 Props */
export interface AIChatMessageProps {
  /** 消息对象 */
  message: ChatMessage
}
