/**
 * Docmost 内容处理 composable
 * 阶段1：Markdown 字符串预处理（附件 URL 绝对化）
 * 阶段2：DOM 后处理（Mermaid / KaTeX 渲染）
 */

/**
 * 从 VITE_DOCMOST_API_URL 提取 Docmost 后端 origin
 * 例如: http://localhost:3000/api/public-wiki → http://localhost:3000
 */
function getDocmostOrigin(): string {
  const apiUrl = import.meta.env.VITE_DOCMOST_API_URL as string | undefined
  if (!apiUrl) return ''
  try {
    const url = new URL(apiUrl)
    return url.origin
  } catch {
    return ''
  }
}

/**
 * 阶段1：将内容中的附件相对路径替换为绝对路径
 *
 * 同时匹配 Markdown 和 HTML 格式的附件 URL：
 * - Markdown: ![alt](/api/files/...) 或 [text](/api/files/...)
 * - HTML: src="/api/files/..." / href="/api/files/..." / data-src="/api/files/..."
 */
export function rewriteAttachmentUrls(content: string): string {
  const origin = getDocmostOrigin()
  if (!origin) return content

  let result = content

  // Markdown 格式：](/ 开头的 /api/files/ 或 /files/ 路径
  result = result.replace(
    /(\]\()(\/(api\/)?files\/)/g,
    (_, prefix, path) => `${prefix}${origin}${path}`
  )

  // HTML 格式：src="/ href="/ data-src="/ 开头的路径（用于 turndown 保留的 HTML 标签如 details）
  result = result.replace(
    /((?:src|href|data-src)=["'])(\/(api\/)?files\/)/g,
    (_, prefix, path) => `${prefix}${origin}${path}`
  )

  return result
}

/**
 * 为没有 id 的标题元素生成锚点 ID（TOC 依赖 heading id 构建目录）
 */
function addHeadingIds(container: HTMLElement): void {
  const headers = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
  const usedIds = new Set<string>()

  headers.forEach((header) => {
    if (header.id) {
      usedIds.add(header.id)
      return
    }

    const text = (header.textContent || '').trim()
    // 生成 slug：保留中文、字母、数字、连字符
    let slug = text
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf-]/g, '')
      .replace(/^-+|-+$/g, '')

    if (!slug) slug = 'heading'

    let uniqueSlug = slug
    let counter = 1
    while (usedIds.has(uniqueSlug)) {
      uniqueSlug = `${slug}-${counter++}`
    }

    header.id = uniqueSlug
    usedIds.add(uniqueSlug)
  })
}

/**
 * 为裸 <pre><code> 代码块（HTML 模式 TipTap 输出）包裹 .code-block-wrapper 结构
 * 跳过已有 wrapper 的（Markdown 模式）和 Mermaid 代码块
 */
function wrapCodeBlocks(container: HTMLElement): void {
  const preElements = container.querySelectorAll<HTMLPreElement>('pre')

  for (const pre of preElements) {
    // 跳过已包裹的（Markdown 模式输出的 pre.code-block-body）
    if (pre.classList.contains('code-block-body')) continue
    // 跳过 Mermaid（由 processMermaid 处理）
    const code = pre.querySelector('code')
    if (!code) continue
    if (code.classList.contains('language-mermaid')) continue
    // 跳过已在 wrapper 内的
    if (pre.parentElement?.classList.contains('code-block-wrapper')) continue

    // 提取语言
    const langMatch = Array.from(code.classList).find(c => c.startsWith('language-'))
    const lang = langMatch ? langMatch.replace('language-', '') : ''
    const langLabel = lang || 'text'

    // 存储原始代码供复制
    const rawCode = code.textContent || ''
    const dataCode = rawCode.replace(/"/g, '&quot;').replace(/\n$/, '')

    // 构建 wrapper
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'

    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.innerHTML = `<span class="code-lang-label">${langLabel}</span>`
      + `<button class="code-copy-btn" data-code="${dataCode}" title="复制代码">`
      + `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
      + `<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>`
      + `</button>`

    pre.classList.add('code-block-body')
    pre.parentNode!.insertBefore(wrapper, pre)
    wrapper.appendChild(header)
    wrapper.appendChild(pre)
  }
}

/** 唯一 ID 计数器，避免 mermaid render id 冲突 */
let mermaidIdCounter = 0

/**
 * 阶段2：DOM 后处理 — 生成标题锚点、代码块包裹、渲染 Mermaid、KaTeX、Embed
 */
export async function processSpecialBlocks(container: HTMLElement): Promise<void> {
  addHeadingIds(container)
  wrapCodeBlocks(container)
  await Promise.all([
    processMermaid(container),
    processKatex(container),
    processEmbeds(container),
  ])
}

/**
 * 预处理 Mermaid 源码，修复 AI 生成的常见语法问题
 *
 * 主要问题：AI 生成的节点标签中包含 () {} 等 Mermaid 语法字符
 * 例如 L[关机前退出代理(重要)] 会被解析器误认为嵌套节点定义
 * 解决：自动为包含特殊字符的标签添加双引号包裹
 */
function sanitizeMermaidSource(source: string): string {
  let result = source

  // 1. 中文标点转英文（中文标点是 Mermaid 语法错误的常见来源）
  result = result
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/【/g, '[').replace(/】/g, ']')
    .replace(/｛/g, '{').replace(/｝/g, '}')
    .replace(/，/g, ',').replace(/；/g, ';')
    .replace(/：/g, ':').replace(/"|"/g, '"')

  // 2. 为 [...] 节点标签中包含 () {} 的内容加双引号
  //    例如 A[文本(注)] → A["文本(注)"]
  result = result.replace(
    /(\b\w+)\[([^\]"]+)\]/g,
    (_match, id, label) => {
      if (/[(){}]/.test(label)) {
        return `${id}["${label}"]`
      }
      return _match
    }
  )

  // 3. 为 (...) 节点标签中包含 [] {} 的内容加双引号
  result = result.replace(
    /(\b\w+)\(([^)"]+)\)/g,
    (_match, id, label) => {
      if (/[[\]{}]/.test(label)) {
        return `${id}("${label}")`
      }
      return _match
    }
  )

  // 4. 为 {...} 节点标签中包含 [] () 的内容加双引号
  result = result.replace(
    /(\b\w+)\{([^}"]+)\}/g,
    (_match, id, label) => {
      if (/[[\]()]/.test(label)) {
        return `${id}{"${label}"}`
      }
      return _match
    }
  )

  return result
}

/**
 * 清理 Mermaid 渲染失败时残留的 DOM 元素
 * Mermaid 在调用 render() 时会创建临时 SVG 容器（id 带 d 前缀），
 * 解析失败时这些元素可能残留在 document.body 中导致页面出现碎片文本
 */
function cleanupMermaidArtifacts(id?: string): void {
  if (id) {
    // 清理特定 ID 的临时元素（Mermaid 内部用 d 前缀）
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
  }
  // 清理所有孤立的 mermaid-wiki 临时元素
  document.querySelectorAll('[id^="dmermaid-wiki-"]').forEach(el => {
    if (!el.closest('.docmost-mermaid-rendered')) {
      el.remove()
    }
  })
}

/**
 * 渲染 Mermaid 图表
 * 查找 pre > code.language-mermaid，渲染为 SVG 替换原 <pre>
 *
 * 渲染策略：原样尝试 → 失败后预处理重试 → 再失败显示降级提示
 */
async function processMermaid(container: HTMLElement): Promise<void> {
  const codeBlocks = container.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
  if (codeBlocks.length === 0) return

  const mermaid = (await import('mermaid')).default

  const isDark = document.documentElement.classList.contains('dark')
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
  })

  for (const codeEl of codeBlocks) {
    const preEl = codeEl.parentElement
    if (!preEl) continue

    const source = codeEl.textContent || ''
    if (!source.trim()) continue

    try {
      let svg: string
      const id = `mermaid-wiki-${++mermaidIdCounter}`

      try {
        // 第一次：原样渲染
        const result = await mermaid.render(id, source)
        svg = result.svg
      } catch {
        // 清理第一次失败的残留
        cleanupMermaidArtifacts(id)

        // 第二次：预处理后重试
        const sanitized = sanitizeMermaidSource(source)
        const retryId = `mermaid-wiki-${++mermaidIdCounter}`
        const result = await mermaid.render(retryId, sanitized)
        svg = result.svg
      }

      // 渲染成功 — 替换原 <pre>
      const wrapper = document.createElement('div')
      wrapper.className = 'docmost-mermaid-rendered'
      wrapper.innerHTML = svg
      preEl.replaceWith(wrapper)
    } catch (err) {
      console.error('[useContentProcessor] Mermaid 渲染失败:', err)

      // 清理所有残留的 Mermaid DOM 碎片
      cleanupMermaidArtifacts()

      // 降级显示：保留代码块 + 错误提示
      preEl.classList.add('docmost-mermaid-error')
      const errorHint = document.createElement('div')
      errorHint.className = 'docmost-mermaid-error-hint'
      errorHint.textContent = '\u26a0\ufe0f 图表语法有误，无法渲染'
      preEl.parentElement?.insertBefore(errorHint, preEl)
    }
  }
}

/**
 * 渲染 KaTeX 公式
 * 查找 [data-katex] 元素，调用 katex.renderToString 替换内容
 */
async function processKatex(container: HTMLElement): Promise<void> {
  const mathElements = container.querySelectorAll<HTMLElement>(
    '[data-type="mathBlock"][data-katex], [data-type="mathInline"][data-katex]'
  )
  if (mathElements.length === 0) return

  const katex = (await import('katex')).default
  // 注入 KaTeX CSS（仅一次）
  if (!document.querySelector('link[data-katex-css]')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.setAttribute('data-katex-css', '')
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css'
    document.head.appendChild(link)
  }

  for (const el of mathElements) {
    const formula = el.textContent || ''
    if (!formula.trim()) continue

    const isBlock = el.getAttribute('data-type') === 'mathBlock'
    try {
      el.innerHTML = katex.renderToString(formula, {
        displayMode: isBlock,
        throwOnError: false,
      })
    } catch (err) {
      console.error('[useContentProcessor] KaTeX 渲染失败:', err)
    }
  }
}

// ─── Embed 处理 ───────────────────────────────────────────

/** Embed provider URL 转换规则（与 packages/editor-ext/src/lib/embed-provider.ts 保持同步） */
interface EmbedProvider {
  id: string
  regex: RegExp
  getEmbedUrl: (match: RegExpMatchArray, url: string) => string
}

const embedProviders: EmbedProvider[] = [
  {
    id: 'loom',
    regex: /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([\da-zA-Z]+)\/?/,
    getEmbedUrl: (match, url) => url.includes('/embed/') ? url : `https://loom.com/embed/${match[1]}`,
  },
  {
    id: 'airtable',
    regex: /^https:\/\/(www.)?airtable.com\/([a-zA-Z0-9]{2,})\/.*/,
    getEmbedUrl: (_match, url) => {
      if (url.includes('/embed/')) return url
      const path = url.split('airtable.com/')[1]
      return `https://airtable.com/embed/${path}`
    },
  },
  {
    id: 'figma',
    regex: /^https:\/\/[\w.-]+\.?figma.com\/(file|proto|board|design|slides|deck)\/([0-9a-zA-Z]{22,128})/,
    getEmbedUrl: (_match, url) => `https://www.figma.com/embed?url=${encodeURIComponent(url)}&embed_host=docmost`,
  },
  {
    id: 'typeform',
    regex: /^(https?:)?(\/\/)?[\w.]+\.typeform\.com\/to\/.+/,
    getEmbedUrl: (_match, url) => url,
  },
  {
    id: 'miro',
    regex: /^https:\/\/(www\.)?miro\.com\/app\/board\/([\w-]+=)/,
    getEmbedUrl: (match, url) =>
      url.includes('/live-embed/')
        ? url
        : `https://miro.com/app/live-embed/${match[2]}?embedMode=view_only_without_ui&autoplay=true&embedSource=docmost`,
  },
  {
    id: 'youtube',
    regex: /^((?:https?:)?\/\/)?((?:www|m|music)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w-]+\?v=|embed\/|v\/)?)([\w-]+)(\S+)?$/,
    getEmbedUrl: (match, url) => url.includes('/embed/') ? url : `https://www.youtube-nocookie.com/embed/${match[5]}`,
  },
  {
    id: 'vimeo',
    regex: /^(https:)?\/\/(?:www\.|player\.)?vimeo.com\/(?:channels\/(?:\w+\/)?|groups\/([^/]*)\/videos\/|album\/(\d+)\/video\/|video\/|)(\d+)/,
    getEmbedUrl: (match) => `https://player.vimeo.com/video/${match[4]}`,
  },
  {
    id: 'framer',
    regex: /^https:\/\/(www\.)?framer\.com\/embed\/([\w-]+)/,
    getEmbedUrl: (_match, url) => url,
  },
  {
    id: 'gdrive',
    regex: /^((?:https?:)?\/\/)?((?:www|m)\.)?(drive\.google\.com)\/file\/d\/([a-zA-Z0-9_-]+)\/.*$/,
    getEmbedUrl: (match) => `https://drive.google.com/file/d/${match[4]}/preview`,
  },
  {
    id: 'gsheets',
    regex: /^((?:https?:)?\/\/)?((?:www|m)\.)?(docs\.google\.com)\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\/.*$/,
    getEmbedUrl: (_match, url) => url,
  },
]

/** 将原始 URL 转换为可嵌入的 iframe URL */
function getEmbedUrl(url: string): string {
  for (const provider of embedProviders) {
    const match = url.match(provider.regex)
    if (match) return provider.getEmbedUrl(match, url)
  }
  return url
}

/**
 * 处理 Embed 嵌入内容
 * 查找 div[data-type="embed"]，将内部的 <a> 链接替换为 <iframe>
 */
function processEmbeds(container: HTMLElement): void {
  const embedDivs = container.querySelectorAll<HTMLElement>('div[data-type="embed"]')
  if (embedDivs.length === 0) return

  for (const div of embedDivs) {
    const src = div.getAttribute('data-src')
    if (!src) continue

    const width = div.getAttribute('data-width') || '100%'
    const height = div.getAttribute('data-height') || '480'

    const embedUrl = getEmbedUrl(src)

    const iframe = document.createElement('iframe')
    iframe.src = embedUrl
    iframe.style.width = /^\d+$/.test(width) ? `${width}px` : width
    iframe.style.height = /^\d+$/.test(height) ? `${height}px` : height
    iframe.style.border = 'none'
    iframe.setAttribute('allowfullscreen', '')
    iframe.setAttribute('allow', 'encrypted-media')
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups')
    iframe.setAttribute('loading', 'lazy')

    // 替换 div 内容为 iframe
    div.innerHTML = ''
    div.appendChild(iframe)
  }
}
