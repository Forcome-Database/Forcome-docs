import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import tailwindcss from '@tailwindcss/vite'
import { zhSidebar, enSidebar, viSidebar } from './sidebar'

/**
 * VitePress 配置文件
 * FORCOME 知识库 - 支持多语言（中/英/越南语）
 *
 * 侧边栏配置已拆分到 ./sidebar/ 目录下
 */

export default withMermaid(defineConfig({
  vite: {
    plugins: [tailwindcss() as any],
    envDir: '../',
    optimizeDeps: { include: ['mermaid', 'dayjs'] },
    ssr: { noExternal: ['mermaid'] }
  },

  title: 'FORCOME 知识库',
  description: 'FORCOME 知识库 - 企业知识管理平台',

  head: [
    ['link', { rel: 'icon', type: 'image/x-icon', href: '/images/logo/favicon.ico' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/images/logo/logo.png' }],
    ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }],
    ['meta', { name: 'theme-color', content: '#000000' }],
    ['link', { rel: 'preload', href: '/fonts/inter/Inter-Regular.woff2', as: 'font', type: 'font/woff2', crossorigin: '' }],
    ['link', { rel: 'preload', href: '/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2', as: 'font', type: 'font/woff2', crossorigin: '' }]
  ],

  locales: {
    zh: {
      label: '中文',
      lang: 'zh-CN',
      link: '/zh/',
      title: 'FORCOME 知识库',
      description: '企业知识管理平台',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/', activeMatch: '^/zh/$' },
          {
            text: '企业应用',
            activeMatch: '^/zh/enterprise/',
            items: [
              { text: '金蝶 ERP', link: '/zh/enterprise/kingdee/' },
              { text: 'CRM 系统', link: '/zh/enterprise/crm/' },
              { text: 'OA 办公', link: '/zh/enterprise/oa/' }
            ]
          },
          {
            text: 'AI应用',
            activeMatch: '^/zh/ai-apps/',
            items: [
              { text: '智能财务', link: '/zh/ai-apps/finance/' },
              { text: '智能PPT', link: '/zh/ai-apps/ppt/' }
            ]
          },
          { text: '知识学习', link: '/zh/learning/', activeMatch: '^/zh/learning/' }
        ],
        sidebar: zhSidebar,
        outline: { label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新于' }
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'FORCOME Knowledge Base',
      description: 'Enterprise Knowledge Management Platform',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/', activeMatch: '^/en/$' },
          {
            text: 'Enterprise',
            activeMatch: '^/en/enterprise/',
            items: [
              { text: 'Kingdee ERP', link: '/en/enterprise/kingdee/' },
              { text: 'CRM System', link: '/en/enterprise/crm/' },
              { text: 'OA System', link: '/en/enterprise/oa/' }
            ]
          },
          {
            text: 'AI Apps',
            activeMatch: '^/en/ai-apps/',
            items: [
              { text: 'Smart Finance', link: '/en/ai-apps/finance/' },
              { text: 'Smart PPT', link: '/en/ai-apps/ppt/' }
            ]
          },
          { text: 'Learning', link: '/en/learning/', activeMatch: '^/en/learning/' }
        ],
        sidebar: enSidebar,
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
        lastUpdated: { text: 'Last updated' }
      }
    },
    vi: {
      label: 'Tiếng Việt',
      lang: 'vi-VN',
      link: '/vi/',
      title: 'FORCOME Cơ sở tri thức',
      description: 'Nền tảng quản lý tri thức doanh nghiệp',
      themeConfig: {
        nav: [
          { text: 'Trang chủ', link: '/vi/', activeMatch: '^/vi/$' },
          {
            text: 'Doanh nghiệp',
            activeMatch: '^/vi/enterprise/',
            items: [
              { text: 'Kingdee ERP', link: '/vi/enterprise/kingdee/' },
              { text: 'Hệ thống CRM', link: '/vi/enterprise/crm/' },
              { text: 'Hệ thống OA', link: '/vi/enterprise/oa/' }
            ]
          },
          {
            text: 'Ứng dụng AI',
            activeMatch: '^/vi/ai-apps/',
            items: [
              { text: 'Tài chính thông minh', link: '/vi/ai-apps/finance/' },
              { text: 'PPT thông minh', link: '/vi/ai-apps/ppt/' }
            ]
          },
          { text: 'Học tập', link: '/vi/learning/', activeMatch: '^/vi/learning/' }
        ],
        sidebar: viSidebar,
        outline: { label: 'Mục lục' },
        docFooter: { prev: 'Trước', next: 'Tiếp' },
        lastUpdated: { text: 'Cập nhật lần cuối' }
      }
    }
  },

  themeConfig: {
    logo: '/images/logo/logo.png',
    siteTitle: 'FORCOME 知识库',
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present FORCOME'
    }
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
    lineNumbers: false,
    config: (md) => {
      // 保存原始的 fence 渲染器
      const defaultFence = md.renderer.rules.fence!
      
      // 自定义 fence 渲染器，处理自定义代码块
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const info = token.info.trim()
        const content = token.content
        
        // 处理 markmap 代码块
        if (info === 'markmap') {
          const encoded = btoa(unescape(encodeURIComponent(content)))
          return `<Markmap content-base64="${encoded}" />`
        }
        
        // 处理带容器的 mermaid 代码块 (mermaid-box)
        if (info.startsWith('mermaid-box')) {
          const encoded = btoa(unescape(encodeURIComponent(content)))
          // 解析可选的标题参数，如 mermaid-box{title="流程图"}
          const titleMatch = info.match(/title="([^"]*)"/)
          const title = titleMatch ? titleMatch[1] : ''
          return `<MermaidWrapper content-base64="${encoded}" ${title ? `title="${title}"` : ''} />`
        }
        
        return defaultFence(tokens, idx, options, env, self)
      }
    }
  },

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true
}))
