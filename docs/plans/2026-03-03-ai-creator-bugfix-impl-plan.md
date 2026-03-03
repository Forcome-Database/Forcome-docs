# AI Creator Bug 修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 10 identified bugs (P0-P3) in the AI Creator module covering selection safety, error recovery, code copy, streaming reliability, security hardening, and code quality.

**Architecture:** Incremental fixes across 7 files. Foundation tasks first (shared utils, type helpers), then critical fixes, then polish. No new dependencies. All changes are backward-compatible.

**Tech Stack:** React 18 + TypeScript + Jotai + TipTap/ProseMirror + Mantine + NestJS/Fastify

---

### Task 1: Create shared utility functions (P3-1)

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-utils.ts`

**Step 1: Create the utils file**

```typescript
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
```

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-utils.ts
git commit -m "refactor(ai): extract shared utils (extractTitle, stripTimestamp, isSelectionStillValid)"
```

---

### Task 2: Add SelectionSnapshot type + Jotai helper (P3-2)

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts` (add SelectionSnapshot after line 8)
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts` (add useNullableAtom helper)

**Step 1: Add SelectionSnapshot to types**

In `ai-creator.types.ts`, after the `AiCreatorMessage` interface (line 8), add:

```typescript
export interface SelectionSnapshot {
  text: string;
  from: number;
  to: number;
}
```

**Step 2: Add useNullableAtom helper to atoms**

In `ai-creator-atoms.ts`, add at the top after existing imports:

```typescript
import { atom, useAtom } from 'jotai';
import type { WritableAtom } from 'jotai';
```

Then at the bottom of the file, add:

```typescript
/**
 * Type-safe hook for nullable Jotai atoms.
 * Eliminates the `_setX as (v: T | null) => void` pattern.
 */
export function useNullableAtom<T>(
  anAtom: WritableAtom<T | null, [T | null], void>,
): [T | null, (value: T | null) => void] {
  const [value, setValue] = useAtom(anAtom);
  return [value, setValue as (v: T | null) => void];
}
```

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts
git commit -m "refactor(ai): add SelectionSnapshot type and useNullableAtom helper"
```

---

### Task 3: Fix onComplete double-call in SSE streaming (P1-4)

**Files:**
- Modify: `apps/client/src/ee/ai/services/ai-service.ts`

**Step 1: Add idempotency guard to `generateAiContentStream`**

In `generateAiContentStream` (line 40), add `let completed = false;` after the `try {` on line 41.

Then change the `[DONE]` handler (line 77-80):
```typescript
if (data === "[DONE]") {
  if (!completed) { completed = true; onComplete?.(); }
  return;
}
```

And change the fallback onComplete after the while loop (line 94):
```typescript
if (!completed) { completed = true; onComplete?.(); }
```

**Step 2: Add same guard to `creatorGenerate`**

In `creatorGenerate` (line 116), add `let completed = false;` after `try {` on line 117.

Change `[DONE]` handler (line 160-163):
```typescript
if (sseData === "[DONE]") {
  if (!completed) { completed = true; onComplete?.(); }
  return;
}
```

Change fallback onComplete after while loop (line 177):
```typescript
if (!completed) { completed = true; onComplete?.(); }
```

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/services/ai-service.ts
git commit -m "fix(ai): prevent onComplete double-call in SSE streaming"
```

---

### Task 4: Fix code copy button + DOMPurify URI restriction (P1-1, P2-2)

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css`

**Step 1: Update imports — use shared utils**

In `ai-creator-message-item.tsx`, replace the local `extractTitle` and `stripTimestamp` definitions (lines 76-88) with an import:

```typescript
import { extractTitle, stripTimestamp } from './ai-creator-utils';
```

Delete lines 76-88 (the two function bodies).

**Step 2: Add copy button to bubbleMarked code renderer**

Replace lines 26-39 (the code renderer) with:

```typescript
    code({ text, lang }: { text: string; lang?: string }) {
      if (!text) return '<pre><code></code></pre>\n';
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      let highlighted: string;
      try {
        highlighted = language
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
      } catch {
        highlighted = text;
      }
      const langLabel = language || lang || "";
      const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      return `<pre class="code-block-wrapper" data-language="${langLabel}"><button class="code-copy-btn" title="Copy">${copyIcon}</button><code class="hljs language-${langLabel}">${highlighted}</code></pre>`;
    },
```

**Step 3: Update DOMPurify config**

Replace lines 44-55 (PURIFY_CONFIG) with:

```typescript
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'pre', 'code', 'span',
    'blockquote', 'hr',
    'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'div',
    'button', 'svg', 'rect', 'path', 'line', 'circle',
  ],
  ALLOWED_ATTR: [
    'class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'data-language',
    'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'xmlns',
  ],
  ALLOWED_URI_REGEXP: /^(?:https?|data):/i,
};
```

**Step 4: Add code copy button CSS**

In `ai-creator.module.css`, after the `.aiContent :global(pre.code-block-wrapper)` block (after line 244), add:

```css
.aiContent :global(pre.code-block-wrapper .code-copy-btn) {
  position: absolute;
  top: 2px;
  right: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: light-dark(var(--mantine-color-gray-5), var(--mantine-color-gray-5));
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.aiContent :global(pre.code-block-wrapper:hover .code-copy-btn) {
  opacity: 1;
}

.aiContent :global(pre.code-block-wrapper .code-copy-btn:hover) {
  background: light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5));
  color: light-dark(var(--mantine-color-gray-8), var(--mantine-color-white));
}
```

**Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css
git commit -m "fix(ai): add code copy button, restrict DOMPurify URIs, use shared utils"
```

---

### Task 5: Fix selection safety + error cleanup + history context + stop cleanup (P0-1, P0-2, P1-2, P1-3, P3-1, P3-2)

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

This is the largest change. All fixes are in one file so they're combined to avoid merge conflicts.

**Step 1: Update imports**

Replace lines 1-48 with updated imports. Key changes:
- Add `import { extractTitle, stripTimestamp, isSelectionStillValid } from './ai-creator-utils';`
- Add `import { SelectionSnapshot } from './ai-creator.types';`
- Replace `useAtom` for nullable atoms with `useNullableAtom` from atoms file
- Remove local `extractTitle` function (lines 54-60)
- Remove local `renderMarkdownToEditorHtml` stays (line 62-64, keep as-is — it's a one-liner wrapper)

Specifically, change line 15-16 imports:
```typescript
import {
  aiCreatorFilesAtom,
  aiCreatorTemplateAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  aiCreatorMessagesAtom,
  aiCreatorStreamingAtom,
  aiCreatorAutoInsertAtom,
  useNullableAtom,
} from "./ai-creator-atoms";
```

Add near the other imports:
```typescript
import { extractTitle, isSelectionStillValid } from './ai-creator-utils';
import type { SelectionSnapshot } from './ai-creator.types';
```

Delete the local `extractTitle` function (lines 54-60).

**Step 2: Replace nullable atom type assertions with useNullableAtom**

Replace lines 73-74:
```typescript
// OLD:
const [template, _setTemplate] = useAtom(aiCreatorTemplateAtom);
const setTemplate = _setTemplate as (v: string | null) => void;
// NEW:
const [template, setTemplate] = useNullableAtom(aiCreatorTemplateAtom);
```

Replace lines 79-80:
```typescript
// OLD:
const [autoInsert, _setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
const setAutoInsert = _setAutoInsert as (v: boolean) => void;
// NEW:
const [autoInsert, setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
```

Note: `aiCreatorAutoInsertAtom` is `atomWithWebStorage<boolean>` which is not nullable, so regular `useAtom` works. Only `aiCreatorTemplateAtom` (type `string | null`) needs the helper.

**Step 3: Add removeLastEmptyAssistant helper**

After `updateLastMessage` (after line 123), add:

```typescript
  /** Remove the last message if it's an empty assistant message (error/abort cleanup) */
  const removeLastEmptyAssistant = useCallback(() => {
    setAllMessages((prev) => {
      const msgs = [...(prev[pageId] || [])];
      if (
        msgs.length > 0 &&
        msgs[msgs.length - 1].role === 'assistant' &&
        !msgs[msgs.length - 1].content.trim()
      ) {
        msgs.pop();
      }
      return { ...prev, [pageId]: msgs };
    });
  }, [pageId, setAllMessages]);
```

**Step 4: Fix handleStop to clean up empty messages**

Replace lines 140-143:

```typescript
  const handleStop = () => {
    abortRef.current?.abort();
    removeLastEmptyAssistant();
    setIsStreaming(false);
  };
```

**Step 5: Add selection snapshot capture in handleSubmit**

After line 182 (`const startTime = Date.now();`), add:

```typescript
    // Capture selection snapshot for validation before insertion
    const selectionSnapshot: SelectionSnapshot | null = selectionRange
      ? {
          text: editor.state.doc.textBetween(selectionRange.from, selectionRange.to),
          from: selectionRange.from,
          to: selectionRange.to,
        }
      : null;
```

**Step 6: Fix history building to include selection context**

Replace lines 193-201 (the history building block):

```typescript
      const history = existingMessages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: (() => {
            if (m.role === "assistant") {
              return m.content.replace(/\n+---\n\*[\d.]+s\*\s*$/, '').trim();
            }
            // Include truncated selection context for continuity
            if (m.selectionContext) {
              return `[修改选区内容]\n${m.selectionContext.slice(0, 200)}\n\n${m.content}`;
            }
            return m.content;
          })(),
        }))
        .slice(-10);
```

**Step 7: Fix onError to clean up empty messages**

Replace lines 220-223:

```typescript
        (error) => {
          removeLastEmptyAssistant();
          notifications.show({ color: "red", message: error.error });
          setIsStreaming(false);
        },
```

**Step 8: Fix auto-insert with selection snapshot validation**

Replace lines 240-278 (the auto-insert block inside onComplete). The key change is using `selectionSnapshot` instead of `selectionRange` and validating before replacing:

```typescript
            if (selectionSnapshot && isSelectionStillValid(editor, selectionSnapshot)) {
              // Selection still valid — replace it
              const $from = editor.state.doc.resolve(selectionSnapshot.from);
              const isInCodeBlock = $from.parent.type.name === "codeBlock";
              const isCodeBlockNodeSelected =
                editor.state.selection instanceof NodeSelection &&
                (editor.state.selection as NodeSelection).node.type.name === "codeBlock";

              if (isInCodeBlock || isCodeBlockNodeSelected) {
                const codeMatch = markdown.match(/```[\w]*\n([\s\S]*?)```/);
                const plainCode = codeMatch ? codeMatch[1].replace(/\n$/, "") : markdown;

                if (isCodeBlockNodeSelected) {
                  const oldNode = (editor.state.selection as NodeSelection).node;
                  const language = oldNode.attrs.language || "mermaid";
                  const newNode = editor.state.schema.nodes.codeBlock.create(
                    { language },
                    plainCode ? editor.state.schema.text(plainCode) : undefined,
                  );
                  const { tr } = editor.state;
                  tr.replaceWith(selectionSnapshot.from, selectionSnapshot.to, newNode);
                  editor.view.dispatch(tr);
                } else {
                  const { tr } = editor.state;
                  tr.insertText(plainCode, selectionSnapshot.from, selectionSnapshot.to);
                  editor.view.dispatch(tr);
                }
              } else {
                const html = renderMarkdownToEditorHtml(markdown);
                if (html) {
                  editor.chain().focus().setTextSelection(selectionSnapshot).insertContent(html).run();
                }
              }
            } else if (selectionSnapshot && !isSelectionStillValid(editor, selectionSnapshot)) {
              // Selection became stale — fallback to append
              const html = renderMarkdownToEditorHtml(markdown);
              if (html) {
                editor.chain().focus("end").insertContent(html).run();
              }
              notifications.show({
                color: "yellow",
                message: t("Selection changed during generation. Content appended to end."),
              });
            } else {
              // No selection — append to end
              const html = renderMarkdownToEditorHtml(markdown);
              if (html) {
                editor.chain().focus("end").insertContent(html).run();
              }
            }
```

**Step 9: Fix catch block to clean up empty messages**

Replace lines 286-289:

```typescript
    } catch (error: any) {
      removeLastEmptyAssistant();
      notifications.show({ color: "red", message: error.message });
      setIsStreaming(false);
    }
```

**Step 10: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx
git commit -m "fix(ai): selection snapshot validation, error cleanup, history context, nullable atom helper"
```

---

### Task 6: Backend history message length limit (P2-1)

**Files:**
- Modify: `apps/server/src/ee/ai/ai.controller.ts`

**Step 1: Add content length limit**

Replace lines 172-184 (the history parsing block):

```typescript
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (historyRaw) {
      try {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed)) {
          history = parsed
            .filter((m: any) => m.role && m.content && typeof m.content === 'string')
            .map((m: any) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content.slice(0, 10000),
            }))
            .slice(-10);
        }
      } catch {
        // Ignore invalid history JSON
      }
    }
```

Key changes:
- Added `typeof m.content === 'string'` type check
- Added `.slice(0, 10000)` per-message content limit
- Moved `.slice(-10)` after `.map()` for cleaner pipeline

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/ai.controller.ts
git commit -m "fix(ai): limit history message content length to prevent cost attacks"
```

---

### Task 7: Verify and final commit

**Step 1: Run TypeScript compilation check**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/client/tsconfig.json 2>&1 | head -30
```

Expected: No errors related to the modified files. Warnings from other files are OK.

**Step 2: Run backend TypeScript check**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/server/tsconfig.json 2>&1 | head -30
```

Expected: No errors related to `ai.controller.ts`.

**Step 3: Visual verification checklist**

Start the dev server and manually verify:
- [ ] Code copy button appears on hover over code blocks in AI messages
- [ ] Clicking the copy button copies code to clipboard
- [ ] Stopping a stream removes empty assistant message
- [ ] Network error doesn't leave empty bubbles
- [ ] "Selection changed" notification appears if editor content changes during streaming
- [ ] Template selection with nullable atom works without type errors

**Step 4: If no errors, create summary commit**

If there were any compilation issues fixed:
```bash
git add -A
git commit -m "fix(ai): resolve compilation issues from bugfix batch"
```
