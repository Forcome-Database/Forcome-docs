/**
 * markdown-it + highlight.js 单例配置
 * 用于 AI 聊天面板和 Docmost 文档内容的 Markdown 渲染
 */
import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/core'

// 注册常用语言
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import sql from 'highlight.js/lib/languages/sql'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('java', java)

// markdown-it 单例（不使用 highlight 选项，改用自定义 fence 规则避免 <pre><code> 双重包裹）
const md = new MarkdownIt({
  breaks: true,
  html: true, // 允许 HTML 透传（details/summary 等 turndown 输出含 HTML 标签）
  linkify: true,
})

/**
 * 自定义 fence 渲染规则
 * 直接替代 markdown-it 默认的 fence 渲染器，完全控制代码块 HTML 输出。
 * 避免默认行为在 highlight 返回值外再包裹 <pre><code> 导致的无效嵌套。
 */
const copySvg = '<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
const checkSvg = '<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>'

md.renderer.rules.fence = function (tokens, idx) {
  const token = tokens[idx]
  const lang = token.info.trim().split(/\s+/)[0] || ''
  const str = token.content

  // Mermaid 代码块保留原始结构，供 processSpecialBlocks() 后处理
  if (lang === 'mermaid') {
    return `<pre><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`
  }

  const escaped = md.utils.escapeHtml(str)
  const dataCode = str.replace(/"/g, '&quot;').replace(/\n$/, '')
  const langLabel = lang || 'text'

  let highlighted: string
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
    } catch {
      highlighted = escaped
    }
  } else {
    highlighted = escaped
  }

  return `<div class="code-block-wrapper">`
    + `<div class="code-block-header">`
    + `<span class="code-lang-label">${md.utils.escapeHtml(langLabel)}</span>`
    + `<button class="code-copy-btn" data-code="${dataCode}" title="复制代码">${copySvg}${checkSvg}</button>`
    + `</div>`
    + `<pre class="code-block-body"><code class="hljs">${highlighted}</code></pre>`
    + `</div>`
}

/**
 * markdown-it-container 插件：处理 :::type 语法生成 VitePress 风格 custom-block
 *
 * Callout 类型映射（turndown 输出 → CSS class）：
 * - info    → .custom-block.info
 * - tip     → .custom-block.tip
 * - warning → .custom-block.warning
 * - danger  → .custom-block.danger
 * - success → .custom-block.tip（复用）
 * - default → .custom-block.info（复用）
 */
const calloutTypes: Record<string, { cssClass: string; title: string }> = {
  info:    { cssClass: 'info',    title: 'INFO' },
  tip:     { cssClass: 'tip',     title: 'TIP' },
  warning: { cssClass: 'warning', title: 'WARNING' },
  danger:  { cssClass: 'danger',  title: 'DANGER' },
  success: { cssClass: 'tip',     title: 'SUCCESS' },
  default: { cssClass: 'info',    title: 'NOTE' },
}

for (const [type, { cssClass, title }] of Object.entries(calloutTypes)) {
  md.use(container, type, {
    render(tokens: any[], idx: number) {
      if (tokens[idx].nesting === 1) {
        return `<div class="custom-block ${cssClass}"><p class="custom-block-title">${title}</p>\n`
      }
      return '</div>\n'
    }
  })
}

// 任务列表插件
md.use(taskLists, { enabled: false, label: true, labelAfter: true })

// 链接默认在新标签页打开
const defaultRender = md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultRender(tokens, idx, options, env, self)
}

export function renderMarkdownToHtml(content: string): string {
  if (!content) return ''
  return md.render(content)
}
