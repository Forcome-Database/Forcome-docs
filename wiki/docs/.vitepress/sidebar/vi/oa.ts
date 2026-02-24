/**
 * 越南语 OA 系统侧边栏配置
 * 路径: /vi/enterprise/oa
 */
import type { SidebarItem } from '../../theme/types'

export const viOaSidebar: SidebarItem[] = [
  {
    text: 'Hệ thống OA',
    items: [
      { text: 'Tổng quan', link: '/vi/enterprise/oa/' },
      { text: 'Sắp ra mắt', link: '/vi/enterprise/oa/coming-soon' }
    ]
  }
]
