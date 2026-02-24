/**
 * 英文智能 PPT 侧边栏配置
 * 路径: /en/ai-apps/ppt
 */
import type { SidebarItem } from '../../theme/types'

export const enAiPptSidebar: SidebarItem[] = [
  {
    text: 'Smart PPT',
    items: [
      { text: 'Overview', link: '/en/ai-apps/ppt/' },
      { text: 'Quickstart', link: '/en/ai-apps/ppt/quickstart' }
    ]
  },
  {
    text: 'Features',
    items: [
      { text: 'Content Generation', link: '/en/ai-apps/ppt/content' },
      { text: 'Smart Design', link: '/en/ai-apps/ppt/design' }
    ]
  }
]
