/**
 * 英文 OA 系统侧边栏配置
 * 路径: /en/enterprise/oa
 */
import type { SidebarItem } from '../../theme/types'

export const enOaSidebar: SidebarItem[] = [
  {
    text: 'OA System',
    items: [
      { text: 'Overview', link: '/en/enterprise/oa/' },
      { text: 'Coming Soon', link: '/en/enterprise/oa/coming-soon' }
    ]
  }
]
