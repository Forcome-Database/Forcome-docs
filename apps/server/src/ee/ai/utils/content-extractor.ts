export interface ImageNodeInfo {
  attachmentId: string;
  src: string;
  alt?: string;
  fileName?: string;
}

export interface DiagramNodeInfo {
  type: 'drawio' | 'excalidraw';
  attachmentId: string;
  src: string;
  title?: string;
}

function traverseNodes(
  node: any,
  visitor: (node: any) => void,
): void {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      traverseNodes(child, visitor);
    }
  }
}

function fileNameFromSrc(src: string): string | undefined {
  if (!src) return undefined;
  const parts = src.split('/');
  const last = parts[parts.length - 1];
  return last || undefined;
}

export function extractImageNodes(prosemirrorJson: any): ImageNodeInfo[] {
  const results: ImageNodeInfo[] = [];
  traverseNodes(prosemirrorJson, (node) => {
    if (node.type === 'image' && node.attrs?.attachmentId) {
      results.push({
        attachmentId: node.attrs.attachmentId,
        src: node.attrs.src || '',
        alt: node.attrs.alt || undefined,
        fileName: fileNameFromSrc(node.attrs.src),
      });
    }
  });
  return results;
}

export function extractDiagramNodes(prosemirrorJson: any): DiagramNodeInfo[] {
  const results: DiagramNodeInfo[] = [];
  traverseNodes(prosemirrorJson, (node) => {
    if (
      (node.type === 'drawio' || node.type === 'excalidraw') &&
      node.attrs?.attachmentId
    ) {
      results.push({
        type: node.type,
        attachmentId: node.attrs.attachmentId,
        src: node.attrs.src || '',
        title: node.attrs.title || undefined,
      });
    }
  });
  return results;
}

/**
 * 将 ProseMirror JSON 转成带内联图片 markdown 的文本。
 * 图片保留在原始位置，使用 ![alt](absoluteUrl) 格式。
 */
export function prosemirrorToTextWithImages(
  node: any,
  appUrl: string,
  imageDescriptions?: Map<string, string>,
): string {
  if (!node || typeof node !== 'object') return '';

  const parts: string[] = [];

  if (node.type === 'text') {
    return node.text || '';
  }

  if (node.type === 'image' && node.attrs?.attachmentId) {
    const src = node.attrs.src || `/api/files/${node.attrs.attachmentId}/${fileNameFromSrc(node.attrs.src) || 'image'}`;
    const absoluteUrl = `${appUrl}${src}`;
    const alt = node.attrs.alt || fileNameFromSrc(node.attrs.src) || '图片';
    const desc = imageDescriptions?.get(node.attrs.attachmentId);
    if (desc) {
      return `\n![${alt}](${absoluteUrl})\n（${desc}）\n`;
    }
    return `\n![${alt}](${absoluteUrl})\n`;
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      parts.push(prosemirrorToTextWithImages(child, appUrl, imageDescriptions));
    }
  }

  const text = parts.join('');

  switch (node.type) {
    case 'heading': {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      return `\n${prefix} ${text.trim()}\n`;
    }
    case 'paragraph':
      return `${text.trim()}\n`;
    case 'bulletList':
    case 'orderedList':
      return `\n${text}`;
    case 'listItem':
      return `- ${text.trim()}\n`;
    case 'blockquote':
      return `> ${text.trim()}\n`;
    case 'codeBlock':
      return `\n\`\`\`\n${text}\n\`\`\`\n`;
    case 'hardBreak':
      return '\n';
    default:
      return text;
  }
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export function extractDrawioText(xmlData: string): string {
  if (!xmlData) return '';

  const texts: string[] = [];
  const attrPattern = /\b(?:value|label)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(xmlData)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const decoded = raw
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    const text = stripHtmlTags(decoded).trim();
    if (text) {
      texts.push(text);
    }
  }

  return texts.join(' ');
}

export function extractExcalidrawText(jsonData: string): string {
  if (!jsonData) return '';

  try {
    const data = JSON.parse(jsonData);
    const elements: any[] = data.elements || data;
    if (!Array.isArray(elements)) return '';

    const texts: string[] = [];
    for (const el of elements) {
      if (el.type === 'text' && el.text) {
        const trimmed = el.text.trim();
        if (trimmed) {
          texts.push(trimmed);
        }
      }
    }
    return texts.join(' ');
  } catch {
    return '';
  }
}
