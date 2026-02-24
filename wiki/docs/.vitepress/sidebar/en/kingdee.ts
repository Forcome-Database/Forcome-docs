/**
 * 英文金蝶 ERP 侧边栏配置
 * 路径: /en/enterprise/kingdee
 */
import type { SidebarItem } from '../../theme/types'

export const enKingdeeSidebar: SidebarItem[] = [
  {
    text: 'Kingdee ERP',
    items: [
      { text: 'Overview', link: '/en/enterprise/kingdee/' },
      { text: 'Quickstart', link: '/en/enterprise/kingdee/quickstart' },
      { text: 'Setup', link: '/en/enterprise/kingdee/setup' }
    ]
  },
  {
    text: 'Finance',
    items: [
      { text: 'Voucher', link: '/en/enterprise/kingdee/finance/voucher' },
      { text: 'Ledger', link: '/en/enterprise/kingdee/finance/books' },
      { text: 'Period Closing', link: '/en/enterprise/kingdee/finance/closing' }
    ]
  },
  {
    text: 'Supply Chain',
    items: [
      { text: 'Purchasing', link: '/en/enterprise/kingdee/scm/purchase' },
      { text: 'Sales', link: '/en/enterprise/kingdee/scm/sales' },
      { text: 'Inventory', link: '/en/enterprise/kingdee/scm/inventory' }
    ]
  }
]
