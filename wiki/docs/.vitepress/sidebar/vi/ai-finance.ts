/**
 * 越南语智能财务侧边栏配置
 * 路径: /vi/ai-apps/finance
 */
import type { SidebarItem } from '../../theme/types'

export const viAiFinanceSidebar: SidebarItem[] = [
  {
    text: 'Tài chính thông minh',
    items: [
      { text: 'Tổng quan', link: '/vi/ai-apps/finance/' },
      { text: 'Bắt đầu nhanh', link: '/vi/ai-apps/finance/quickstart' }
    ]
  },
  {
    text: 'Tính năng',
    items: [
      { text: 'Kế toán', link: '/vi/ai-apps/finance/bookkeeping' },
      { text: 'Đối chiếu', link: '/vi/ai-apps/finance/reconciliation' }
    ]
  }
]
