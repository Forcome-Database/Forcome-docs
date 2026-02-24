/**
 * 英文侧边栏配置聚合
 */
import type { SidebarRouteConfig } from '../../theme/types'
import { enHomeSidebar } from './home'
import { enKingdeeSidebar } from './kingdee'
import { enCrmSidebar } from './crm'
import { enOaSidebar } from './oa'
import { enAiFinanceSidebar } from './ai-finance'
import { enAiPptSidebar } from './ai-ppt'
import { enLearningSidebar } from './learning'

export const enSidebar: SidebarRouteConfig = {
  '/en/': enHomeSidebar,
  '/en/enterprise/kingdee': enKingdeeSidebar,
  '/en/enterprise/crm': enCrmSidebar,
  '/en/enterprise/oa': enOaSidebar,
  '/en/ai-apps/finance': enAiFinanceSidebar,
  '/en/ai-apps/ppt': enAiPptSidebar,
  '/en/learning': enLearningSidebar
}

// 导出各模块供单独使用
export {
  enHomeSidebar,
  enKingdeeSidebar,
  enCrmSidebar,
  enOaSidebar,
  enAiFinanceSidebar,
  enAiPptSidebar,
  enLearningSidebar
}
