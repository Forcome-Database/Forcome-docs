/**
 * 越南语金蝶 ERP 侧边栏配置
 * 路径: /vi/enterprise/kingdee
 */
import type { SidebarItem } from '../../theme/types'

export const viKingdeeSidebar: SidebarItem[] = [
  {
    text: 'Kingdee ERP',
    items: [
      { text: 'Tổng quan', link: '/vi/enterprise/kingdee/' },
      { text: 'Bắt đầu nhanh', link: '/vi/enterprise/kingdee/quickstart' },
      { text: 'Cấu hình', link: '/vi/enterprise/kingdee/setup' }
    ]
  },
  {
    text: 'Tài chính',
    items: [
      { text: 'Chứng từ', link: '/vi/enterprise/kingdee/finance/voucher' },
      { text: 'Sổ cái', link: '/vi/enterprise/kingdee/finance/books' },
      { text: 'Kết chuyển', link: '/vi/enterprise/kingdee/finance/closing' }
    ]
  },
  {
    text: 'Chuỗi cung ứng',
    items: [
      { text: 'Mua hàng', link: '/vi/enterprise/kingdee/scm/purchase' },
      { text: 'Bán hàng', link: '/vi/enterprise/kingdee/scm/sales' },
      { text: 'Kho', link: '/vi/enterprise/kingdee/scm/inventory' }
    ]
  }
]
