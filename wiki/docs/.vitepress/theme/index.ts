/**
 * 自定义主题入口
 * Cursor 风格文档平台
 */
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { markRaw } from 'vue'

// 导入 VitePress 默认主题样式（包含 Markdown 渲染样式）
import 'vitepress/dist/client/theme-default/styles/vars.css'
import 'vitepress/dist/client/theme-default/styles/base.css'
import 'vitepress/dist/client/theme-default/styles/utils.css'
import 'vitepress/dist/client/theme-default/styles/components/custom-block.css'
import 'vitepress/dist/client/theme-default/styles/components/vp-code.css'
import 'vitepress/dist/client/theme-default/styles/components/vp-code-group.css'
import 'vitepress/dist/client/theme-default/styles/components/vp-doc.css'

// 导入 Tailwind CSS
import './styles/tailwind.css'

// 导入自定义样式（覆盖默认主题）
import './styles/vars.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/markdown.css'
import './styles/transitions.css'

// 导入自定义布局组件
import Layout from './Layout.vue'

// 导入全局组件
import Markmap from './components/Markmap.vue'
import MermaidWrapper from './components/MermaidWrapper.vue'

// 导入 Docmost 动态内容组件
import DocmostContent from './components/DocmostContent.vue'

function isDocmostRoute(path: string): boolean {
  return /^\/(zh|en|vi)\/docs\//.test(path)
}

const theme: Theme = {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app, router }) {
    app.component('Markmap', Markmap)
    app.component('MermaidWrapper', MermaidWrapper)

    // 拦截 Docmost 路由：阻止 VitePress 查找 .md 文件，避免 404
    router.onBeforePageLoad = (to: string) => {
      if (isDocmostRoute(to)) {
        // relativePath 必须以 locale 前缀开头（如 "zh/docs/..."），
        // VitePress 通过它解析当前 locale，决定 themeConfig（nav、sidebar 等）
        const relativePath = to.replace(/^\//, '') + '/index.md'
        router.route.path = to
        router.route.component = markRaw(DocmostContent)
        router.route.data = {
          relativePath,
          filePath: '',
          title: '',
          description: '',
          headers: [],
          frontmatter: { sidebar: true },
          params: {},
          isNotFound: false,
          lastUpdated: 0,
        } as any
        return false
      }
      return true
    }
  }
}

export default theme
