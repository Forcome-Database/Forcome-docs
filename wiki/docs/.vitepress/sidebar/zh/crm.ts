/**
 * 中文 CRM 系统侧边栏配置
 * 路径: /zh/enterprise/crm
 */
import type { SidebarItem } from '../../theme/types'

export const zhCrmSidebar: SidebarItem[] = [
  {
    text: 'CRM 系统',
    items: [
      { text: '概述', link: '/zh/enterprise/crm/' },
      { text: '快速开始', link: '/zh/enterprise/crm/quickstart' },
      { text: '系统配置', link: '/zh/enterprise/crm/setup' }
    ]
  },
  {
    text: '客户管理',
    items: [
      { text: '客户信息', link: '/zh/enterprise/crm/customer/info' },
      { text: '客户分类', link: '/zh/enterprise/crm/customer/category' },
      { text: '联系人管理', link: '/zh/enterprise/crm/customer/contacts' }
    ]
  },
  {
    text: '销售管理',
    items: [
      { text: '销售机会', link: '/zh/enterprise/crm/sales/opportunity' },
      { text: '销售漏斗', link: '/zh/enterprise/crm/sales/funnel' },
      { text: '合同管理', link: '/zh/enterprise/crm/sales/contract' }
    ]
  }
]
