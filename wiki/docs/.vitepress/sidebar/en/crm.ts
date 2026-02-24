/**
 * 英文 CRM 系统侧边栏配置
 * 路径: /en/enterprise/crm
 */
import type { SidebarItem } from '../../theme/types'

export const enCrmSidebar: SidebarItem[] = [
  {
    text: 'CRM System',
    items: [
      { text: 'Overview', link: '/en/enterprise/crm/' },
      { text: 'Quickstart', link: '/en/enterprise/crm/quickstart' }
    ]
  },
  {
    text: 'Customer',
    items: [
      { text: 'Customer Info', link: '/en/enterprise/crm/customer/info' },
      { text: 'Contacts', link: '/en/enterprise/crm/customer/contacts' }
    ]
  }
]
