/**
 * 中文智能 PPT 侧边栏配置
 * 路径: /zh/ai-apps/ppt
 */
import type { SidebarItem } from '../../theme/types'

export const zhAiPptSidebar: SidebarItem[] = [
  {
    text: '智能PPT',
    items: [
      { text: '概述', link: '/zh/ai-apps/ppt/' },
      { text: '快速开始', link: '/zh/ai-apps/ppt/quickstart' }
    ]
  },
  {
    text: '核心功能',
    items: [
      { text: '内容生成', link: '/zh/ai-apps/ppt/content' },
      { text: '智能设计', link: '/zh/ai-apps/ppt/design' },
      { text: '导出分享', link: '/zh/ai-apps/ppt/export' }
    ]
  }
]
