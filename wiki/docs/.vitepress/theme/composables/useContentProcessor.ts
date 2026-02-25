/**
 * Docmost 内容处理 composable
 * 阶段1：HTML 字符串预处理（附件 URL 绝对化）
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
 * 阶段1：将 HTML 中的附件相对路径替换为绝对路径
 *
 * 匹配模式：
 * - src="/api/files/..." 或 src="/files/..."
 * - href="/api/files/..." 或 href="/files/..."
 * - data-src="/api/files/..." 或 data-src="/files/..."
 */
export function rewriteAttachmentUrls(html: string): string {
  const origin = getDocmostOrigin()
  if (!origin) return html

  // 匹配 src="/ href="/ data-src="/ 开头的 /api/files/ 或 /files/ 路径
  return html.replace(
    /((?:src|href|data-src)=["'])(\/(api\/)?files\/)/g,
    (_, prefix, path) => `${prefix}${origin}${path}`
  )
}

/** 唯一 ID 计数器，避免 mermaid render id 冲突 */
let mermaidIdCounter = 0

/**
 * 阶段2：DOM 后处理 — 渲染 Mermaid、KaTeX、Embed
 */
export async function processSpecialBlocks(container: HTMLElement): Promise<void> {
  await Promise.all([
    processMermaid(container),
    processKatex(container),
    processEmbeds(container),
  ])
}

/**
 * 渲染 Mermaid 图表
 * 查找 pre > code.language-mermaid，渲染为 SVG 替换原 <pre>
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
      const id = `mermaid-wiki-${++mermaidIdCounter}`
      const { svg } = await mermaid.render(id, source)

      // 创建容器替换原 <pre>
      const wrapper = document.createElement('div')
      wrapper.className = 'docmost-mermaid-rendered'
      wrapper.innerHTML = svg
      preEl.replaceWith(wrapper)
    } catch (err) {
      console.error('[useContentProcessor] Mermaid 渲染失败:', err)
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
