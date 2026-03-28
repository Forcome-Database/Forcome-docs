import { markdownToHtml } from "@docmost/editor-ext";
import { preprocessImagesForEditor } from "../components/ai-creator/ai-creator-utils";

export interface ApplyOptions {
  editor: any;
  titleEditor?: any;
  markdown: string;
  mode: "full" | "replace" | "insert";
  from?: number;
  to?: number;
}

export interface ApplyResult {
  ok: boolean;
  snapshot: any; // editor JSON for rollback
  reason?: string;
}

/**
 * Apply markdown content to a TipTap editor via ProseMirror commands.
 *
 * Saves a snapshot before any modification and rolls back on error.
 *
 * Modes:
 *   - "full"    — replaces entire document content
 *   - "replace" — replaces the range [from, to] (both required)
 *   - "insert"  — inserts at position `from` (required)
 */
export async function safeApply(options: ApplyOptions): Promise<ApplyResult> {
  const { editor, markdown, mode, from, to } = options;

  // 1. Save snapshot before any mutation
  const snapshot = editor.getJSON();

  try {
    // 2. Convert markdown → HTML
    // markdownToHtml returns string | Promise<string>; .toString() coerces synchronous path
    const raw = markdownToHtml(preprocessImagesForEditor(markdown));
    const html = raw instanceof Promise ? await raw : raw;

    // 3. Apply based on mode
    switch (mode) {
      case "full": {
        editor.commands.setContent(html);
        break;
      }
      case "replace": {
        if (from == null || to == null) {
          return {
            ok: false,
            snapshot,
            reason: 'mode "replace" requires valid from and to positions',
          };
        }
        editor.commands.insertContentAt({ from, to }, html);
        break;
      }
      case "insert": {
        if (from == null) {
          return {
            ok: false,
            snapshot,
            reason: 'mode "insert" requires a valid from position',
          };
        }
        editor.commands.insertContentAt(from, html);
        break;
      }
      default: {
        return {
          ok: false,
          snapshot,
          reason: `unknown mode: ${mode as string}`,
        };
      }
    }

    return { ok: true, snapshot };
  } catch (err) {
    // Rollback to snapshot on any error
    try {
      editor.commands.setContent(snapshot);
    } catch {
      // Ignore rollback errors — original snapshot is still returned
    }

    const reason =
      err instanceof Error ? err.message : "unknown error during apply";
    return { ok: false, snapshot, reason };
  }
}

/**
 * Roll back the editor to a previously captured snapshot.
 * Snapshot must be a value previously returned by `editor.getJSON()`.
 */
export function rollbackApply(editor: any, snapshot: any): void {
  editor.commands.setContent(snapshot);
}
