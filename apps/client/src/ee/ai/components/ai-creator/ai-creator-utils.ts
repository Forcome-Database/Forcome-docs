/** Extract first H1 from markdown, return [title, remainingMarkdown] */
export function extractTitle(markdown: string): [string | null, string] {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) return [null, markdown];
  const title = match[1].trim();
  const remaining = markdown.replace(/^#\s+.+\n*/m, '').trim();
  return [title, remaining];
}

/** Strip trailing elapsed-time line (e.g. "\n\n---\n*2.5s*") */
export function stripTimestamp(content: string): string {
  return content.replace(/\n+---\n\*[\d.]+s\*\s*$/, '').trim();
}

/** Check if a selection snapshot is still valid against current editor state */
export function isSelectionStillValid(
  editor: { state: { doc: { content: { size: number }; textBetween: (from: number, to: number) => string } } },
  snapshot: { text: string; from: number; to: number },
): boolean {
  const docSize = editor.state.doc.content.size;
  if (snapshot.from < 0 || snapshot.to > docSize) return false;
  try {
    const current = editor.state.doc.textBetween(snapshot.from, snapshot.to);
    return current === snapshot.text;
  } catch {
    return false;
  }
}
