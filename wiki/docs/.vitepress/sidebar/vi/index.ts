/**
 * 越南语侧边栏配置聚合
 */
import type { SidebarRouteConfig } from '../../theme/types'
import { viHomeSidebar } from './home'
import { viKingdeeSidebar } from './kingdee'
import { viCrmSidebar } from './crm'
import { viOaSidebar } from './oa'
import { viAiFinanceSidebar } from './ai-finance'
import { viAiPptSidebar } from './ai-ppt'
import { viLearningSidebar } from './learning'

export const viSidebar: SidebarRouteConfig = {
  '/vi/': viHomeSidebar,
  '/vi/enterprise/kingdee': viKingdeeSidebar,
  '/vi/enterprise/crm': viCrmSidebar,
  '/vi/enterprise/oa': viOaSidebar,
  '/vi/ai-apps/finance': viAiFinanceSidebar,
  '/vi/ai-apps/ppt': viAiPptSidebar,
  '/vi/learning': viLearningSidebar
}

// 导出各模块供单独使用
export {
  viHomeSidebar,
  viKingdeeSidebar,
  viCrmSidebar,
  viOaSidebar,
  viAiFinanceSidebar,
  viAiPptSidebar,
  viLearningSidebar
}
