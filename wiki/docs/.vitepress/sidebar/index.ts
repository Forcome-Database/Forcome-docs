/**
 * 侧边栏配置聚合入口
 * 导出所有语言的侧边栏配置
 */
import { zhSidebar } from './zh'
import { enSidebar } from './en'
import { viSidebar } from './vi'

export { zhSidebar, enSidebar, viSidebar }

// 导出各语言模块供单独使用
export * from './zh'
export * from './en'
export * from './vi'

// 导出自动生成器
export { generateSidebar, quickGenerate } from './generator'
export type { GeneratorOptions, GeneratorResult, FileInfo } from './generator'
