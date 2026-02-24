/**
 * 中文金蝶 ERP 侧边栏配置
 * 路径: /zh/enterprise/kingdee
 */
import type { SidebarItem } from '../../theme/types'

export const zhKingdeeSidebar: SidebarItem[] = [
  {
    text: '金蝶 ERP',
    items: [
      { text: '概述', link: '/zh/enterprise/kingdee/' },
      { text: '快速开始', link: '/zh/enterprise/kingdee/quickstart' },
      { text: '系统配置', link: '/zh/enterprise/kingdee/setup' }
    ]
  },
  {
    text: '财务管理',
    items: [
      { text: '凭证管理', link: '/zh/enterprise/kingdee/finance/voucher' },
      { text: '账簿查询', link: '/zh/enterprise/kingdee/finance/books' },
      { text: '期末结账', link: '/zh/enterprise/kingdee/finance/closing' },
      { text: '应收应付', link: '/zh/enterprise/kingdee/finance/receivable' },
      { text: '固定资产', link: '/zh/enterprise/kingdee/finance/assets' }
    ]
  },
  {
    text: '供应链',
    items: [
      { text: '采购管理', link: '/zh/enterprise/kingdee/scm/purchase' },
      { text: '销售管理', link: '/zh/enterprise/kingdee/scm/sales' },
      { text: '库存管理', link: '/zh/enterprise/kingdee/scm/inventory' }
    ]
  },
  {
    text: '生产制造',
    items: [
      { text: '生产计划', link: '/zh/enterprise/kingdee/mfg/planning' },
      { text: '物料需求', link: '/zh/enterprise/kingdee/mfg/mrp' },
      { text: '车间管理', link: '/zh/enterprise/kingdee/mfg/workshop' }
    ]
  }
]
