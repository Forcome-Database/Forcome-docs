export type DocumentAssetSourceType = 'attachment' | 'image' | 'diagram';

export interface DocumentAssetProjection {
  sourceType: DocumentAssetSourceType;
  attachmentId: string;
  title: string;
  rawUrl?: string;
  snippet?: string;
}

export interface DocumentAssetCitation {
  sourceType: DocumentAssetSourceType;
  title: string;
  pageId?: string;
  pageSlugId?: string;
  pageTitle?: string;
  spaceSlug?: string;
  attachmentId: string;
  pageUrl?: string;
  publicAssetUrl?: string;
  snippet?: string;
}

export interface DocumentLinkProjection {
  text: string;
  href: string;
}

interface ContextProjectionOptions {
  resolveAssetUrl?: (asset: DocumentAssetProjection) => string | undefined;
  imageDescriptions?: Map<string, string>;
}

interface CollectAssetSourceOptions extends ContextProjectionOptions {
  pageId?: string;
  pageSlugId?: string;
  pageTitle?: string;
  pageUrl?: string;
  spaceSlug?: string;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function fileNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;

  const cleanUrl = url.split('?')[0];
  const parts = cleanUrl.split('/').filter(Boolean);
  const last = parts[parts.length - 1];

  if (!last) return undefined;

  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function getNodeText(node: any): string {
  if (!node || typeof node !== 'object') return '';

  if (node.type === 'text') {
    const text = node.text || '';
    const normalizedText = text.trim() || text;
    const linkMark = Array.isArray(node.marks)
      ? node.marks.find((mark: any) => mark?.type === 'link' && mark?.attrs?.href)
      : null;

    if (linkMark) {
      return `${normalizedText} ${linkMark.attrs.href}`.trim();
    }

    return text;
  }

  if (node.type === 'mention') {
    return node.attrs?.label || '';
  }

  if (!Array.isArray(node.content)) {
    return '';
  }

  return node.content.map((child) => getNodeText(child)).join('');
}

function getAssetProjection(
  node: any,
  imageDescriptions?: Map<string, string>,
): DocumentAssetProjection | null {
  const attachmentId = node?.attrs?.attachmentId;
  if (!attachmentId) return null;

  if (node.type === 'attachment') {
    const title =
      node.attrs?.name ||
      fileNameFromUrl(node.attrs?.url) ||
      fileNameFromUrl(node.attrs?.src) ||
      'attachment';

    return {
      sourceType: 'attachment',
      attachmentId,
      title,
      rawUrl: node.attrs?.url || node.attrs?.src,
      snippet: node.attrs?.mime,
    };
  }

  if (node.type === 'image') {
    const title =
      node.attrs?.alt ||
      fileNameFromUrl(node.attrs?.src) ||
      'image';
    const description = imageDescriptions?.get(attachmentId);

    return {
      sourceType: 'image',
      attachmentId,
      title,
      rawUrl: node.attrs?.src,
      snippet: description,
    };
  }

  if (node.type === 'drawio' || node.type === 'excalidraw') {
    const title =
      node.attrs?.title ||
      fileNameFromUrl(node.attrs?.src) ||
      'diagram';

    return {
      sourceType: 'diagram',
      attachmentId,
      title,
      rawUrl: node.attrs?.src,
      snippet: node.type,
    };
  }

  return null;
}

function renderAssetForSearch(node: any): string {
  const asset = getAssetProjection(node);
  if (!asset) return '';

  return [asset.title, asset.snippet].filter(Boolean).join(' ');
}

function renderAssetForContext(
  node: any,
  options: ContextProjectionOptions,
): string {
  const asset = getAssetProjection(node, options.imageDescriptions);
  if (!asset) return '';

  const resolvedUrl = options.resolveAssetUrl?.(asset) || asset.rawUrl;

  if (asset.sourceType === 'image') {
    const imageLine = resolvedUrl
      ? `![${asset.title}](${resolvedUrl})`
      : asset.title;

    return asset.snippet
      ? `\n${imageLine}\n${asset.snippet}\n`
      : `\n${imageLine}\n`;
  }

  const linkLine = resolvedUrl
    ? `[${asset.title}](${resolvedUrl})`
    : asset.title;

  return `\n${linkLine}\n`;
}

function renderNode(
  node: any,
  mode: 'search' | 'context',
  options: ContextProjectionOptions,
): string {
  if (!node || typeof node !== 'object') return '';

  if (node.type === 'text') {
    const text = node.text || '';
    const normalizedText = text.trim() || text;
    const linkMark = Array.isArray(node.marks)
      ? node.marks.find((mark: any) => mark?.type === 'link' && mark?.attrs?.href)
      : null;

    if (!linkMark) {
      return text;
    }

    const href = linkMark.attrs.href;
    if (mode === 'search') {
      return `${normalizedText} ${href}`.trim();
    }

    return `[${normalizedText || href}](${href})`;
  }

  if (node.type === 'hardBreak') {
    return '\n';
  }

  if (node.type === 'mention') {
    return node.attrs?.label || '';
  }

  if (
    node.type === 'attachment' ||
    node.type === 'image' ||
    node.type === 'drawio' ||
    node.type === 'excalidraw'
  ) {
    return mode === 'search'
      ? renderAssetForSearch(node)
      : renderAssetForContext(node, options);
  }

  const childText = Array.isArray(node.content)
    ? node.content
        .map((child) => renderNode(child, mode, options))
        .join('')
    : '';

  switch (node.type) {
    case 'doc':
      return childText;
    case 'heading': {
      if (mode === 'context') {
        const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 1));
        return `\n${'#'.repeat(level)} ${childText.trim()}\n`;
      }
      return `${childText.trim()}\n`;
    }
    case 'paragraph':
    case 'blockquote':
    case 'callout':
    case 'details':
    case 'detailsSummary':
    case 'detailsContent':
    case 'tableCell':
    case 'tableHeader':
    case 'tableRow':
      return `${childText.trim()}\n`;
    case 'bulletList':
    case 'orderedList':
    case 'table':
      return `\n${childText}\n`;
    case 'listItem':
    case 'taskItem': {
      const prefix =
        mode === 'context'
          ? node.type === 'taskItem'
            ? node.attrs?.checked
              ? '- [x] '
              : '- [ ] '
            : '- '
          : '';
      return `${prefix}${childText.trim()}\n`;
    }
    case 'codeBlock':
      return mode === 'context'
        ? `\n\`\`\`\n${childText.trim()}\n\`\`\`\n`
        : `${childText.trim()}\n`;
    default:
      return childText || getNodeText(node);
  }
}

function collectAssetsFromNode(
  node: any,
  options: CollectAssetSourceOptions,
  items: DocumentAssetCitation[],
  seen: Set<string>,
): void {
  if (!node || typeof node !== 'object') return;

  const asset = getAssetProjection(node, options.imageDescriptions);
  if (asset) {
    const dedupeKey = `${asset.sourceType}:${asset.attachmentId}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      items.push({
        sourceType: asset.sourceType,
        title: asset.title,
        pageId: options.pageId,
        pageSlugId: options.pageSlugId,
        pageTitle: options.pageTitle,
        spaceSlug: options.spaceSlug,
        attachmentId: asset.attachmentId,
        pageUrl: options.pageUrl,
        publicAssetUrl: options.resolveAssetUrl?.(asset),
        snippet: asset.snippet,
      });
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectAssetsFromNode(child, options, items, seen);
    }
  }
}

function collectAssetProjectionsFromNode(
  node: any,
  items: DocumentAssetProjection[],
  seen: Set<string>,
  imageDescriptions?: Map<string, string>,
): void {
  if (!node || typeof node !== 'object') return;

  const asset = getAssetProjection(node, imageDescriptions);
  if (asset) {
    const dedupeKey = `${asset.sourceType}:${asset.attachmentId}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      items.push(asset);
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectAssetProjectionsFromNode(child, items, seen, imageDescriptions);
    }
  }
}

function collectLinkProjectionsFromNode(
  node: any,
  items: DocumentLinkProjection[],
  seen: Set<string>,
): void {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'text' && Array.isArray(node.marks)) {
    const linkMark = node.marks.find(
      (mark: any) => mark?.type === 'link' && mark?.attrs?.href,
    );

    if (linkMark) {
      const href = linkMark.attrs.href;
      const text = (node.text || '').trim() || href;
      const dedupeKey = `${text}:${href}`;

      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        items.push({ text, href });
      }
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectLinkProjectionsFromNode(child, items, seen);
    }
  }
}

export function projectProsemirrorToSearchText(document: any): string {
  return normalizeWhitespace(
    renderNode(document, 'search', {}),
  );
}

export function projectProsemirrorToContextText(
  document: any,
  options: ContextProjectionOptions = {},
): string {
  return normalizeWhitespace(
    renderNode(document, 'context', options),
  );
}

export function collectDocumentAssetSources(
  document: any,
  options: CollectAssetSourceOptions = {},
): DocumentAssetCitation[] {
  const items: DocumentAssetCitation[] = [];
  const seen = new Set<string>();

  collectAssetsFromNode(document, options, items, seen);
  return items;
}

export function collectDocumentAssetProjections(
  document: any,
  imageDescriptions?: Map<string, string>,
): DocumentAssetProjection[] {
  const items: DocumentAssetProjection[] = [];
  const seen = new Set<string>();

  collectAssetProjectionsFromNode(document, items, seen, imageDescriptions);
  return items;
}

export function collectDocumentLinkProjections(
  document: any,
): DocumentLinkProjection[] {
  const items: DocumentLinkProjection[] = [];
  const seen = new Set<string>();

  collectLinkProjectionsFromNode(document, items, seen);
  return items;
}
