/**
 * 越南语首页侧边栏配置
 * 路径: /vi/
 */
import type { SidebarItem } from '../../theme/types'

export const viHomeSidebar: SidebarItem[] = [
  {
    text: 'Bắt đầu',
    items: [
      { text: 'Chào mừng', link: '/vi/' },
      { text: 'Bắt đầu nhanh', link: '/vi/quickstart' }
    ]
  }
]
