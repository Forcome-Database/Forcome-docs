/**
 * Markdown 文件解析器
 * 从 Markdown 文件中提取标题和 frontmatter
 */
import * as fs from 'fs'
import type { ParsedMarkdown } from './types'

/**
 * 解析 Markdown 文件，提取标题信息
 *
 * @param filePath 文件绝对路径
 * @returns 解析结果
 */
export function parseMarkdownFile(filePath: string): ParsedMarkdown {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return parseMarkdownContent(content)
  } catch {
    return { title: null }
  }
}

/**
 * 解析 Markdown 内容
 *
 * @param content Markdown 内容
 * @returns 解析结果
 */
export function parseMarkdownContent(content: string): ParsedMarkdown {
  const result: ParsedMarkdown = { title: null }

  // 解析 frontmatter
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]

    // 提取 title
    const titleMatch = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (titleMatch) {
      result.frontmatterTitle = titleMatch[1].trim()
    }

    // 提取 order
    const orderMatch = frontmatter.match(/^order:\s*(\d+)\s*$/m)
    if (orderMatch) {
      result.order = parseInt(orderMatch[1], 10)
    }
  }

  // 提取一级标题（# 开头的行）
  // 跳过 frontmatter 后查找
  const contentWithoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const h1Match = contentWithoutFrontmatter.match(/^#\s+(.+)$/m)
  if (h1Match) {
    result.title = h1Match[1].trim()
  }

  return result
}

/**
 * 获取文件的显示标题
 * 优先级：frontmatter title > h1 标题 > 文件名
 *
 * @param parsed 解析结果
 * @param filename 文件名（不含扩展名）
 * @returns 显示标题
 */
export function getDisplayTitle(parsed: ParsedMarkdown, filename: string): string {
  if (parsed.frontmatterTitle) {
    return parsed.frontmatterTitle
  }
  if (parsed.title) {
    return parsed.title
  }
  // 将文件名转换为标题格式
  return formatFilenameAsTitle(filename)
}

/**
 * 将文件名格式化为标题
 * 例如：quick-start -> Quick Start
 *
 * @param filename 文件名
 * @returns 格式化后的标题
 */
export function formatFilenameAsTitle(filename: string): string {
  return filename
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
