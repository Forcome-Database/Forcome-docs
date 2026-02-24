/**
 * 越南语知识学习侧边栏配置
 * 路径: /vi/learning
 */
import type { SidebarItem } from '../../theme/types'

export const viLearningSidebar: SidebarItem[] = [
  {
    text: 'Học tập',
    items: [
      { text: 'Tổng quan', link: '/vi/learning/' },
      { text: 'Lộ trình', link: '/vi/learning/roadmap' }
    ]
  },
  {
    text: 'LLM cơ bản',
    items: [
      { text: 'LLM là gì', link: '/vi/learning/llm/intro' },
      { text: 'Prompt Engineering', link: '/vi/learning/llm/prompt' }
    ]
  }
]
