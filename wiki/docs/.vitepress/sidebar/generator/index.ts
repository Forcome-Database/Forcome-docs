/**
 * 侧边栏自动生成器
 * 基于目录结构自动生成侧边栏配置
 */
import type { SidebarItem } from '../../theme/types'
import type { GeneratorOptions, GeneratorResult, FileInfo } from './types'
import { scanDirectory, sortFiles, defaultSortFn } from './scanner'

export type { GeneratorOptions, GeneratorResult, FileInfo }
export { parseMarkdownFile, parseMarkdownContent, getDisplayTitle } from './parser'
export { scanDirectory, sortFiles, defaultSortFn } from './scanner'

/**
 * 生成侧边栏配置
 *
 * @param options 生成器配置
 * @returns 生成结果
 *
 * @example
 * ```ts
 * import { generateSidebar } from './sidebar/generator'
 *
 * const result = generateSidebar({
 *   docsDir: 'docs',
 *   scanDir: 'zh/enterprise/kingdee',
 *   locale: 'zh'
 * })
 *
 * // 使用生成的配置
 * const sidebar = {
 *   '/zh/enterprise/kingdee': result.sidebar
 * }
 * ```
 */
export function generateSidebar(options: GeneratorOptions): GeneratorResult {
  const { sortFn = defaultSortFn } = options

  // 扫描目录
  const files = scanDirectory(options)

  // 排序
  const sortedFiles = sortFiles(files, sortFn)

  // 转换为侧边栏配置
  const sidebar = filesToSidebarItems(sortedFiles, options)

  // 统计
  const stats = countFilesAndDirs(sortedFiles)

  return {
    sidebar,
    fileCount: stats.files,
    dirCount: stats.dirs
  }
}

/**
 * 将文件信息转换为侧边栏项
 */
function filesToSidebarItems(
  files: FileInfo[],
  options: GeneratorOptions
): SidebarItem[] {
  const { scanDir, locale } = options
  const basePath = locale ? `/${locale}/${scanDir}` : `/${scanDir}`

  return files.map(file => fileToSidebarItem(file, basePath))
}

/**
 * 将单个文件信息转换为侧边栏项
 */
function fileToSidebarItem(file: FileInfo, basePath: string): SidebarItem {
  if (file.isDirectory && file.children) {
    // 目录：创建分组
    const items = file.children
      .filter(child => !child.isDirectory || (child.children && child.children.length > 0))
      .map(child => fileToSidebarItem(child, `${basePath}/${file.name}`))

    // 检查是否有 index.md
    const hasIndex = file.children.some(
      child => child.name === 'index' && !child.isDirectory
    )

    const item: SidebarItem = {
      text: file.title || file.name,
      items: items.filter(i => i.text !== 'Index') // 过滤掉 index 项，因为它会作为分组链接
    }

    // 如果有 index.md，将其作为分组的链接
    if (hasIndex) {
      item.link = `${basePath}/${file.name}/`
    }

    return item
  } else {
    // 文件：创建链接项
    const link = file.name === 'index'
      ? `${basePath}/`
      : `${basePath}/${file.name}`

    return {
      text: file.title || file.name,
      link
    }
  }
}

/**
 * 统计文件和目录数量
 */
function countFilesAndDirs(files: FileInfo[]): { files: number; dirs: number } {
  let fileCount = 0
  let dirCount = 0

  for (const file of files) {
    if (file.isDirectory) {
      dirCount++
      if (file.children) {
        const childStats = countFilesAndDirs(file.children)
        fileCount += childStats.files
        dirCount += childStats.dirs
      }
    } else {
      fileCount++
    }
  }

  return { files: fileCount, dirs: dirCount }
}

/**
 * 快速生成单个目录的侧边栏
 * 简化版本，适用于简单场景
 *
 * @param docsDir 文档根目录
 * @param scanDir 扫描目录
 * @returns 侧边栏配置数组
 */
export function quickGenerate(docsDir: string, scanDir: string): SidebarItem[] {
  const result = generateSidebar({ docsDir, scanDir })
  return result.sidebar
}
