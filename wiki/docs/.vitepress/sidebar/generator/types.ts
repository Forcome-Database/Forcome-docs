/**
 * 侧边栏生成器类型定义
 */
import type { SidebarItem } from '../../theme/types'

/** 生成器配置选项 */
export interface GeneratorOptions {
  /** 文档根目录（相对于项目根目录） */
  docsDir: string
  /** 要扫描的目录（相对于 docsDir） */
  scanDir: string
  /** 语言前缀 */
  locale?: string
  /** 是否递归扫描子目录 */
  recursive?: boolean
  /** 排除的文件/目录模式 */
  exclude?: string[]
  /** 自定义排序函数 */
  sortFn?: (a: FileInfo, b: FileInfo) => number
}

/** 文件信息 */
export interface FileInfo {
  /** 文件名（不含扩展名） */
  name: string
  /** 完整文件名（含扩展名） */
  filename: string
  /** 相对路径 */
  relativePath: string
  /** 绝对路径 */
  absolutePath: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 从文件中提取的标题 */
  title?: string
  /** 子文件（如果是目录） */
  children?: FileInfo[]
}

/** 解析后的 Markdown 文件信息 */
export interface ParsedMarkdown {
  /** 一级标题 */
  title: string | null
  /** frontmatter 中的标题 */
  frontmatterTitle?: string
  /** frontmatter 中的排序权重 */
  order?: number
}

/** 生成结果 */
export interface GeneratorResult {
  /** 生成的侧边栏配置 */
  sidebar: SidebarItem[]
  /** 扫描的文件数量 */
  fileCount: number
  /** 扫描的目录数量 */
  dirCount: number
}
