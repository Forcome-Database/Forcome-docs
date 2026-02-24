/**
 * 中文智能财务侧边栏配置
 * 路径: /zh/ai-apps/finance
 */
import type { SidebarItem } from '../../theme/types'

export const zhAiFinanceSidebar: SidebarItem[] = [
  {
    text: '智能财务',
    items: [
      { text: '概述', link: '/zh/ai-apps/finance/' },
      { text: '快速开始', link: '/zh/ai-apps/finance/quickstart' }
    ]
  },
  {
    text: '核心功能',
    items: [
      { text: '智能记账', link: '/zh/ai-apps/finance/bookkeeping' },
      { text: '智能对账', link: '/zh/ai-apps/finance/reconciliation' },
      { text: '报表分析', link: '/zh/ai-apps/finance/reports' }
    ]
  }
]
