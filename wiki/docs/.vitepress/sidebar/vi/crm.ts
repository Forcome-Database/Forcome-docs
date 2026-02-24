/**
 * 越南语 CRM 系统侧边栏配置
 * 路径: /vi/enterprise/crm
 */
import type { SidebarItem } from '../../theme/types'

export const viCrmSidebar: SidebarItem[] = [
  {
    text: 'Hệ thống CRM',
    items: [
      { text: 'Tổng quan', link: '/vi/enterprise/crm/' },
      { text: 'Bắt đầu nhanh', link: '/vi/enterprise/crm/quickstart' }
    ]
  },
  {
    text: 'Khách hàng',
    items: [
      { text: 'Thông tin', link: '/vi/enterprise/crm/customer/info' },
      { text: 'Liên hệ', link: '/vi/enterprise/crm/customer/contacts' }
    ]
  }
]
