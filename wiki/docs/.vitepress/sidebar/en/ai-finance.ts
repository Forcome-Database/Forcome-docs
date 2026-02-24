/**
 * 英文智能财务侧边栏配置
 * 路径: /en/ai-apps/finance
 */
import type { SidebarItem } from '../../theme/types'

export const enAiFinanceSidebar: SidebarItem[] = [
  {
    text: 'Smart Finance',
    items: [
      { text: 'Overview', link: '/en/ai-apps/finance/' },
      { text: 'Quickstart', link: '/en/ai-apps/finance/quickstart' }
    ]
  },
  {
    text: 'Features',
    items: [
      { text: 'Bookkeeping', link: '/en/ai-apps/finance/bookkeeping' },
      { text: 'Reconciliation', link: '/en/ai-apps/finance/reconciliation' }
    ]
  }
]
