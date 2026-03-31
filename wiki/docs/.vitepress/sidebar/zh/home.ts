/**
 * 中文首页侧边栏配置
 * 路径: /zh/
 */
import type { SidebarItem } from '../../theme/types'

export const zhHomeSidebar: SidebarItem[] = [
  {
    text: '开始使用',
    items: [
      { text: '欢迎', link: '/zh/' },
      { text: '快速入门', link: '/zh/quickstart' }
    ]
  },
  {
    text: '操作指南',
    collapsed: true,
    items: [
      { text: '文档搜索与阅读', link: '/zh/guide/reading' },
      { text: '创建与编辑文档', link: '/zh/guide/editing' },
      { text: 'AI 智能问答', link: '/zh/guide/ai-qa' },
      { text: '康康写作', link: '/zh/guide/smart-writer' },
      { text: '协作与权限', link: '/zh/guide/collaboration' }
    ]
  }
]
