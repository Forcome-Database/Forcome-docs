/**
 * 文件目录扫描器
 * 递归扫描目录，收集 Markdown 文件信息
 */
import * as fs from 'fs'
import * as path from 'path'
import type { FileInfo, GeneratorOptions } from './types'
import { parseMarkdownFile, getDisplayTitle } from './parser'

/** 默认排除的文件/目录 */
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.vitepress',
  '.git',
  'public',
  'assets',
  '.DS_Store'
]

/**
 * 扫描目录，收集文件信息
 *
 * @param options 生成器配置
 * @returns 文件信息数组
 */
export function scanDirectory(options: GeneratorOptions): FileInfo[] {
  const {
    docsDir,
    scanDir,
    recursive = true,
    exclude = []
  } = options

  const absoluteScanDir = path.resolve(docsDir, scanDir)
  const excludePatterns = [...DEFAULT_EXCLUDES, ...exclude]

  if (!fs.existsSync(absoluteScanDir)) {
    console.warn(`[sidebar-generator] Directory not found: ${absoluteScanDir}`)
    return []
  }

  return scanDirectoryRecursive(absoluteScanDir, scanDir, excludePatterns, recursive)
}

/**
 * 递归扫描目录
 */
function scanDirectoryRecursive(
  absoluteDir: string,
  relativeDir: string,
  excludePatterns: string[],
  recursive: boolean
): FileInfo[] {
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
  const files: FileInfo[] = []

  for (const entry of entries) {
    const name = entry.name

    // 检查是否应该排除
    if (shouldExclude(name, excludePatterns)) {
      continue
    }

    const absolutePath = path.join(absoluteDir, name)
    const relativePath = path.join(relativeDir, name)

    if (entry.isDirectory()) {
      if (recursive) {
        const children = scanDirectoryRecursive(
          absolutePath,
          relativePath,
          excludePatterns,
          recursive
        )

        // 只添加非空目录
        if (children.length > 0) {
          // 检查目录是否有 index.md
          const indexFile = children.find(
            f => f.name === 'index' && f.filename === 'index.md'
          )

          files.push({
            name: name,
            filename: name,
            relativePath,
            absolutePath,
            isDirectory: true,
            title: indexFile?.title || formatDirName(name),
            children
          })
        }
      }
    } else if (name.endsWith('.md')) {
      const baseName = name.replace(/\.md$/, '')
      const parsed = parseMarkdownFile(absolutePath)
      const title = getDisplayTitle(parsed, baseName)

      files.push({
        name: baseName,
        filename: name,
        relativePath,
        absolutePath,
        isDirectory: false,
        title
      })
    }
  }

  return files
}

/**
 * 检查文件/目录是否应该被排除
 */
function shouldExclude(name: string, patterns: string[]): boolean {
  // 排除隐藏文件
  if (name.startsWith('.')) {
    return true
  }

  // 检查排除模式
  for (const pattern of patterns) {
    if (name === pattern) {
      return true
    }
    // 简单的通配符支持
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      if (regex.test(name)) {
        return true
      }
    }
  }

  return false
}

/**
 * 格式化目录名为标题
 */
function formatDirName(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * 默认排序函数
 * index.md 优先，然后按字母顺序
 */
export function defaultSortFn(a: FileInfo, b: FileInfo): number {
  // index.md 始终排在最前面
  if (a.name === 'index') return -1
  if (b.name === 'index') return 1

  // 目录排在文件前面
  if (a.isDirectory && !b.isDirectory) return -1
  if (!a.isDirectory && b.isDirectory) return 1

  // 按名称字母顺序排序
  return a.name.localeCompare(b.name)
}

/**
 * 对文件列表进行排序
 */
export function sortFiles(
  files: FileInfo[],
  sortFn: (a: FileInfo, b: FileInfo) => number = defaultSortFn
): FileInfo[] {
  const sorted = [...files].sort(sortFn)

  // 递归排序子目录
  for (const file of sorted) {
    if (file.isDirectory && file.children) {
      file.children = sortFiles(file.children, sortFn)
    }
  }

  return sorted
}
