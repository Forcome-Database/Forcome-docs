/**
 * 中文 OA 办公侧边栏配置
 * 路径: /zh/enterprise/oa
 */
import type { SidebarItem } from '../../theme/types'

export const zhOaSidebar: SidebarItem[] = [
  {
    text: 'OA 办公',
    items: [
      { text: '概述', link: '/zh/enterprise/oa/' },
      { text: '即将推出', link: '/zh/enterprise/oa/coming-soon' }
    ]
  }
]
