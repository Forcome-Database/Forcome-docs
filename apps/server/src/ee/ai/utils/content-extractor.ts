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
