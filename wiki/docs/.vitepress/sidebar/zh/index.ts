/**
 * 中文侧边栏配置聚合
 */
import type { SidebarRouteConfig } from '../../theme/types'
import { zhHomeSidebar } from './home'
import { zhKingdeeSidebar } from './kingdee'
import { zhCrmSidebar } from './crm'
import { zhOaSidebar } from './oa'
import { zhAiFinanceSidebar } from './ai-finance'
import { zhAiPptSidebar } from './ai-ppt'
import { zhLearningSidebar } from './learning'

export const zhSidebar: SidebarRouteConfig = {
  '/zh/': zhHomeSidebar,
  '/zh/enterprise/kingdee': zhKingdeeSidebar,
  '/zh/enterprise/crm': zhCrmSidebar,
  '/zh/enterprise/oa': zhOaSidebar,
  '/zh/ai-apps/finance': zhAiFinanceSidebar,
  '/zh/ai-apps/ppt': zhAiPptSidebar,
  '/zh/learning': zhLearningSidebar
}

// 导出各模块供单独使用
export {
  zhHomeSidebar,
  zhKingdeeSidebar,
  zhCrmSidebar,
  zhOaSidebar,
  zhAiFinanceSidebar,
  zhAiPptSidebar,
  zhLearningSidebar
}
