/**
 * markdown-it + highlight.js 单例配置
 * 用于 AI 聊天面板的 Markdown 渲染
 */
import MarkdownIt from 'markdown-it'
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

// markdown-it 单例
const md = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  highlight(str: string, lang: string): string {
    const escaped = md.utils.escapeHtml(str)
    // data-code 存储原始代码供复制按钮使用
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
      + `<button class="code-copy-btn" data-code="${dataCode}" title="复制代码">`
      + `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
      + `<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>`
      + `</button>`
      + `</div>`
      + `<pre class="code-block-body"><code class="hljs">${highlighted}</code></pre>`
      + `</div>`
  }
})

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
