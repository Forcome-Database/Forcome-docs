/**
 * 中文知识学习侧边栏配置
 * 路径: /zh/learning
 */
import type { SidebarItem } from '../../theme/types'

export const zhLearningSidebar: SidebarItem[] = [
  {
    text: '知识学习',
    items: [
      { text: '概述', link: '/zh/learning/' },
      { text: '学习路径', link: '/zh/learning/roadmap' }
    ]
  },
  {
    text: '大模型基础',
    items: [
      { text: '什么是大模型', link: '/zh/learning/llm/intro' },
      { text: 'Prompt 工程', link: '/zh/learning/llm/prompt' },
      { text: 'RAG 技术', link: '/zh/learning/llm/rag' }
    ]
  }
]
