/**
 * 英文知识学习侧边栏配置
 * 路径: /en/learning
 */
import type { SidebarItem } from '../../theme/types'

export const enLearningSidebar: SidebarItem[] = [
  {
    text: 'Learning',
    items: [
      { text: 'Overview', link: '/en/learning/' },
      { text: 'Roadmap', link: '/en/learning/roadmap' }
    ]
  },
  {
    text: 'LLM Basics',
    items: [
      { text: 'What is LLM', link: '/en/learning/llm/intro' },
      { text: 'Prompt Engineering', link: '/en/learning/llm/prompt' }
    ]
  }
]
