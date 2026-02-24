/**
 * 越南语智能 PPT 侧边栏配置
 * 路径: /vi/ai-apps/ppt
 */
import type { SidebarItem } from '../../theme/types'

export const viAiPptSidebar: SidebarItem[] = [
  {
    text: 'PPT thông minh',
    items: [
      { text: 'Tổng quan', link: '/vi/ai-apps/ppt/' },
      { text: 'Bắt đầu nhanh', link: '/vi/ai-apps/ppt/quickstart' }
    ]
  },
  {
    text: 'Tính năng',
    items: [
      { text: 'Tạo nội dung', link: '/vi/ai-apps/ppt/content' },
      { text: 'Thiết kế', link: '/vi/ai-apps/ppt/design' }
    ]
  }
]
