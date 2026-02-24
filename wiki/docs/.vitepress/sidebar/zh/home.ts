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
      { text: '快速入门', link: '/zh/quickstart' },
      { text: '图表指南', link: '/zh/diagrams' }
    ]
  }
]
