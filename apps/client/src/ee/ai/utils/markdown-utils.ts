/**
 * Shared markdown utilities for AI editor integration.
 * Extracted from ai-creator-utils.ts and ai-creator-writeback.ts for V2 reuse.
 */

/** Extract first H1 from markdown, return [title, remainingMarkdown] */
export function extractTitle(markdown: string): [string | null, string] {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) return [null, markdown];
  const title = match[1].trim();
  const remaining = markdown.replace(/^#\s+.+\n*/m, '').trim();
  return [title, remaining];
}

/**
 * Ensure markdown image syntax is converted to HTML img tags
 * for TipTap editor insertion.
 */
export function preprocessImagesForEditor(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" />',
  );
}

/**
 * If the page has no title yet, extract the first H1 from markdown
 * and set it as the page title. Returns the remaining markdown.
 */
export function maybeExtractTitle(
  titleEditor: any,
  markdown: string,
): string {
  if (!titleEditor) {
    return markdown;
  }

  const currentTitle = titleEditor.state.doc.textContent.trim();
  if (currentTitle) {
    return markdown;
  }

  const [title, remaining] = extractTitle(markdown);
  if (title) {
    titleEditor.commands.setContent(title);
    return remaining;
  }

  return markdown;
}
