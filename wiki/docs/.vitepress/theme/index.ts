/**
 * 自定义主题入口
 * Cursor 风格文档平台
 */
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'

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

const theme: Theme = {
  extends: DefaultTheme,
  // 使用自定义 Layout 组件
  Layout,
  // 注册全局组件
  enhanceApp({ app }) {
    app.component('Markmap', Markmap)
    app.component('MermaidWrapper', MermaidWrapper)
  }
}

export default theme
