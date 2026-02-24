/**
 * 英文首页侧边栏配置
 * 路径: /en/
 */
import type { SidebarItem } from '../../theme/types'

export const enHomeSidebar: SidebarItem[] = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Welcome', link: '/en/' },
      { text: 'Quickstart', link: '/en/quickstart' }
    ]
  }
]
