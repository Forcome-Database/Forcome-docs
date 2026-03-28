import { htmlToMarkdown } from "@docmost/editor-ext";
import { DOMSerializer } from "@tiptap/pm/model";

/** Maximum number of characters stored in each text anchor. */
const ANCHOR_LENGTH = 100;

/** Number of sibling block nodes to collect for context before/after. */
const CONTEXT_BLOCKS = 3;

export interface EditorSelection {
  mode: "replace" | "insert" | "full";
  from: number | null;
  to: number | null;
  /** Markdown of selected content */
  selectedText: string | null;
  /** 2-3 block nodes immediately before the selection, as markdown */
  contextBefore: string;
  /** 2-3 block nodes immediately after the selection, as markdown */
  contextAfter: string;
  /** Document heading structure */
  documentOutline: string;
  /** Last 100 chars of text immediately before selection (text anchor) */
  anchorBefore: string;
  /** First 100 chars of text immediately after selection (text anchor) */
  anchorAfter: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Serialize a ProseMirror range [from, to) to HTML using the document schema. */
function sliceToHtml(editor: any, from: number, to: number): string {
  const slice = editor.state.doc.slice(from, to);
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const div = document.createElement("div");
  div.appendChild(serializer.serializeFragment(slice.content));
  return div.innerHTML;
}

/** Convert a ProseMirror range to Markdown. Returns empty string on error. */
function rangeToMarkdown(editor: any, from: number, to: number): string {
  try {
    const html = sliceToHtml(editor, from, to);
    return htmlToMarkdown(html);
  } catch {
    return "";
  }
}

/** Build the heading outline from the whole document. */
function extractOutline(doc: any): string {
  const headings: string[] = [];
  doc.descendants((node: any) => {
    if (node.type.name === "heading") {
      const level = node.attrs?.level || 1;
      headings.push("#".repeat(level) + " " + node.textContent);
    }
  });
  return headings.join("\n");
}

/**
 * Collect up to `count` top-level block positions before `pos` (exclusive).
 * Returns [startOfFirstBlock, endOfLastBlock] or null if nothing found.
 */
function blocksBefore(
  doc: any,
  pos: number,
  count: number,
): { from: number; to: number } | null {
  // Collect all top-level block boundaries
  const blocks: Array<{ from: number; to: number }> = [];
  doc.forEach((node: any, offset: number) => {
    const blockEnd = offset + node.nodeSize;
    if (blockEnd <= pos) {
      blocks.push({ from: offset, to: blockEnd });
    }
  });
  if (blocks.length === 0) return null;
  const slice = blocks.slice(-count);
  return { from: slice[0].from, to: slice[slice.length - 1].to };
}

/**
 * Collect up to `count` top-level block positions starting at or after `pos`.
 * Returns [startOfFirstBlock, endOfLastBlock] or null if nothing found.
 */
function blocksAfter(
  doc: any,
  pos: number,
  count: number,
): { from: number; to: number } | null {
  const blocks: Array<{ from: number; to: number }> = [];
  doc.forEach((node: any, offset: number) => {
    const blockStart = offset;
    if (blockStart >= pos) {
      blocks.push({ from: blockStart, to: offset + node.nodeSize });
    }
  });
  if (blocks.length === 0) return null;
  const slice = blocks.slice(0, count);
  return { from: slice[0].from, to: slice[slice.length - 1].to };
}

/**
 * Find the start position of the top-level block that contains `pos`.
 * Returns `pos` if resolution fails.
 */
function resolveBlockStart(doc: any, pos: number): number {
  try {
    const $pos = doc.resolve(pos);
    // depth 0 is the document itself; depth 1 is the top-level block
    if ($pos.depth >= 1) {
      return $pos.start(1) - 1; // before the opening token
    }
  } catch {
    // ignore
  }
  return pos;
}

/**
 * Find the end position of the top-level block that contains `pos`.
 * Returns `pos` if resolution fails.
 */
function resolveBlockEnd(doc: any, pos: number): number {
  try {
    const $pos = doc.resolve(pos);
    if ($pos.depth >= 1) {
      return $pos.end(1) + 1; // after the closing token
    }
  } catch {
    // ignore
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture the current TipTap editor selection as an `EditorSelection` object.
 *
 * - Non-empty selection → REPLACE mode (boundaries expanded to block edges)
 * - Empty selection at pos > 1 → INSERT mode
 * - Otherwise → FULL mode (null positions, empty text)
 */
export function captureEditorSelection(editor: any): EditorSelection {
  const { state } = editor;
  const { selection, doc } = state;

  const outline = extractOutline(doc);

  // --- FULL mode: no meaningful selection ---
  if (selection.empty && selection.from <= 1) {
    return {
      mode: "full",
      from: null,
      to: null,
      selectedText: null,
      contextBefore: "",
      contextAfter: "",
      documentOutline: outline,
      anchorBefore: "",
      anchorAfter: "",
    };
  }

  // --- INSERT mode: cursor placed inside document ---
  if (selection.empty) {
    const cursorPos = selection.from;

    // Context blocks
    const beforeRange = blocksBefore(doc, resolveBlockStart(doc, cursorPos), CONTEXT_BLOCKS);
    const afterRange = blocksAfter(doc, resolveBlockEnd(doc, cursorPos), CONTEXT_BLOCKS);

    const contextBefore = beforeRange
      ? rangeToMarkdown(editor, beforeRange.from, beforeRange.to)
      : "";
    const contextAfter = afterRange
      ? rangeToMarkdown(editor, afterRange.from, afterRange.to)
      : "";

    // Text anchors — use "\n" separator consistent with verifyAndRelocate
    const anchorBefore = doc.textBetween(
      Math.max(0, cursorPos - ANCHOR_LENGTH),
      cursorPos,
      "\n",
    );
    const anchorAfter = doc.textBetween(
      cursorPos,
      Math.min(doc.content.size, cursorPos + ANCHOR_LENGTH),
      "\n",
    );

    return {
      mode: "insert",
      from: cursorPos,
      to: cursorPos,
      selectedText: null,
      contextBefore,
      contextAfter,
      documentOutline: outline,
      anchorBefore,
      anchorAfter,
    };
  }

  // --- REPLACE mode: non-empty selection ---
  // Expand to block boundaries
  const rawFrom = selection.from;
  const rawTo = selection.to;
  const blockFrom = resolveBlockStart(doc, rawFrom);
  const blockTo = resolveBlockEnd(doc, rawTo);

  // Clamp to valid doc range
  const from = Math.max(0, blockFrom);
  const to = Math.min(doc.content.size, blockTo);

  const selectedText = rangeToMarkdown(editor, from, to);

  // Context blocks outside the expanded selection
  const beforeRange = blocksBefore(doc, from, CONTEXT_BLOCKS);
  const afterRange = blocksAfter(doc, to, CONTEXT_BLOCKS);

  const contextBefore = beforeRange
    ? rangeToMarkdown(editor, beforeRange.from, beforeRange.to)
    : "";
  const contextAfter = afterRange
    ? rangeToMarkdown(editor, afterRange.from, afterRange.to)
    : "";

  // Text anchors at BLOCK-EXPANDED positions — must match verifyAndRelocate's
  // positions. Use "\n" separator consistent with fullText extraction in verify.
  const anchorBefore = doc.textBetween(
    Math.max(0, from - ANCHOR_LENGTH),
    from,
    "\n",
  );
  const anchorAfter = doc.textBetween(
    to,
    Math.min(doc.content.size, to + ANCHOR_LENGTH),
    "\n",
  );

  return {
    mode: "replace",
    from,
    to,
    selectedText,
    contextBefore,
    contextAfter,
    documentOutline: outline,
    anchorBefore,
    anchorAfter,
  };
}

/**
 * Verify that the previously captured selection positions still correspond to
 * the same text, and return adjusted positions if the document has shifted.
 *
 * Fast path: text at stored [from, to] matches stored anchors.
 * Slow path: search for anchor substrings to relocate.
 *
 * Returns `null` if the positions cannot be verified or relocated.
 */
export function verifyAndRelocate(
  editor: any,
  selection: EditorSelection,
): { from: number; to: number } | null {
  if (selection.from == null || selection.to == null) return null;

  const { state } = editor;
  const { doc } = state;
  const docSize = doc.content.size;

  const from = selection.from;
  const to = selection.to;

  // --- Fast path: verify positions are still in range and anchors match ---
  if (from >= 0 && to <= docSize && from <= to) {
    const beforeOk = _anchorMatchesAt(doc, from, selection.anchorBefore, "before");
    const afterOk = _anchorMatchesAt(doc, to, selection.anchorAfter, "after");

    if (beforeOk && afterOk) {
      return { from, to };
    }
  }

  // --- Slow path: relocate using anchor substrings ---
  if (!selection.anchorBefore && !selection.anchorAfter) {
    // No anchors to search with
    console.warn("[editor-selection] Cannot relocate: no text anchors stored.");
    return null;
  }

  const fullText = doc.textBetween(0, docSize, "\n");

  // Try to find anchorBefore in the document text
  if (selection.anchorBefore) {
    const searchText = selection.anchorBefore.trim();
    if (searchText.length > 0) {
      const idx = fullText.lastIndexOf(searchText);
      if (idx >= 0) {
        // Map text offset back to ProseMirror position
        const newFrom = _textOffsetToDocPos(doc, idx + searchText.length);
        if (newFrom !== null) {
          // Estimate new `to` by original selection length
          const originalLength = to - from;
          const newTo = Math.min(docSize, newFrom + originalLength);
          return { from: newFrom, to: newTo };
        }
      }
    }
  }

  // Try to find anchorAfter in the document text
  if (selection.anchorAfter) {
    const searchText = selection.anchorAfter.trim();
    if (searchText.length > 0) {
      const idx = fullText.indexOf(searchText);
      if (idx >= 0) {
        const newTo = _textOffsetToDocPos(doc, idx);
        if (newTo !== null) {
          const originalLength = to - from;
          const newFrom = Math.max(0, newTo - originalLength);
          return { from: newFrom, to: newTo };
        }
      }
    }
  }

  console.warn("[editor-selection] Could not relocate selection — positions may be stale.");
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers for verifyAndRelocate
// ---------------------------------------------------------------------------

/**
 * Check whether `anchorText` still appears immediately before (or after) `pos`
 * in the document's text stream.
 */
function _anchorMatchesAt(
  doc: any,
  pos: number,
  anchorText: string,
  direction: "before" | "after",
): boolean {
  if (!anchorText) return true; // empty anchor is always valid
  try {
    const docSize = doc.content.size;
    if (direction === "before") {
      const start = Math.max(0, pos - ANCHOR_LENGTH);
      const text = doc.textBetween(start, Math.min(pos, docSize), "\n");
      return text.endsWith(anchorText) || anchorText.endsWith(text);
    } else {
      const end = Math.min(docSize, pos + ANCHOR_LENGTH);
      const text = doc.textBetween(Math.max(0, pos), end, "\n");
      return text.startsWith(anchorText) || anchorText.startsWith(text);
    }
  } catch {
    return false;
  }
}

/**
 * Convert a character offset in the plain-text representation of the document
 * (as produced by `doc.textBetween(0, size, "\n")`) back to a ProseMirror
 * document position.
 *
 * This is a best-effort approximation: it walks nodes counting text length.
 * Returns null if the offset cannot be mapped.
 */
function _textOffsetToDocPos(doc: any, charOffset: number): number | null {
  let remaining = charOffset;
  let result: number | null = null;

  doc.descendants((node: any, pos: number) => {
    if (result !== null) return false; // stop early
    if (node.isText) {
      if (remaining <= node.text.length) {
        result = pos + remaining;
        return false;
      }
      remaining -= node.text.length;
    } else if (node.isBlock && !node.isLeaf) {
      // Account for the separator "\n" injected by textBetween
      if (remaining === 0) {
        result = pos;
        return false;
      }
      remaining -= 1; // the "\n" separator
    }
  });

  return result;
}
