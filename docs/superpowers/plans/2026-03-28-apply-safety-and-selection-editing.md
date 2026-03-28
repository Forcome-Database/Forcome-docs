# Apply Safety & Selection-Based Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the destructive server-side Apply mechanism with safe TipTap-native commands, add selection-based editing (replace/insert/full modes), and fix three systemic reliability issues discovered in global review.

**Architecture:** Phase A (Tasks 1-3) makes Apply safe and can ship independently. Phase B (Tasks 4-9) adds selection-based editing. Phase C (Tasks 10-11) hardens the system. Each phase produces working, testable software.

**Tech Stack:** TipTap 3 / ProseMirror (frontend Apply), @docmost/editor-ext htmlToMarkdown/markdownToHtml, PydanticAI 1.72.0 (agent), React/TypeScript/Mantine (UI).

**Spec:** `docs/superpowers/specs/2026-03-28-selection-editing-and-apply-safety.md`

**Worktree:** `E:/test/Docmost/.worktrees/feat-intelligent-agent/`

---

## File Structure

### New Files

```
apps/client/src/ee/ai/utils/
├── editor-selection.ts          # Selection capture + text-anchor utilities
└── safe-apply.ts                # TipTap-native Apply with snapshot rollback
```

### Modified Files

```
# Phase A: Apply Safety
apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx  # handleApply rewrite
agent-service/app/agent/runner.py                             # Retry history fix + read_page warning

# Phase B: Selection Editing
apps/client/src/ee/ai/types/agent-v2.types.ts                # New fields
apps/client/src/ee/ai/services/agent-v2-service.ts            # Send selection data
apps/client/src/ee/ai/hooks/use-agent-session.ts              # Selection state + editMode
apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx  # Mode indicator + selection capture
apps/client/src/ee/ai/components/agent-panel/input-bar.tsx    # Mode indicator display
agent-service/app/agent/deps.py                               # SelectionContext dataclass
agent-service/app/agent/runner.py                             # Selection prompt construction
agent-service/app/agent/skills/editing.py                     # Selection mode instructions
apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts  # Pass through selection fields

# Phase C: System Hardening
agent-service/app/main.py                                     # Task registration
apps/client/src/ee/ai/hooks/use-agent-session.ts              # Editor unlock cleanup
```

---

## Phase A: Apply Safety (can ship independently)

### Task 1: Safe Apply Utility

**Files:**
- Create: `apps/client/src/ee/ai/utils/safe-apply.ts`

- [ ] **Step 1: Create safe-apply.ts with TipTap-native Apply**

```typescript
// apps/client/src/ee/ai/utils/safe-apply.ts
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
  snapshot: any;  // editor JSON for rollback
  reason?: string;
}

/**
 * Apply agent output to the TipTap editor using native commands.
 *
 * All operations go through ProseMirror → y-prosemirror → Yjs,
 * ensuring proper rendering and collaboration compatibility.
 */
export function safeApply(options: ApplyOptions): ApplyResult {
  const { editor, markdown, mode, from, to } = options;

  // 1. Save snapshot for rollback
  const snapshot = editor.getJSON();

  try {
    // 2. Convert markdown to HTML via Docmost pipeline
    const html = markdownToHtml(preprocessImagesForEditor(markdown)) as string;

    if (!html || !html.trim()) {
      return { ok: false, snapshot, reason: "Empty content after conversion" };
    }

    // 3. Apply based on mode
    switch (mode) {
      case "replace":
        if (from != null && to != null) {
          editor.commands.insertContentAt({ from, to }, html, {
            updateSelection: true,
            parseOptions: { preserveWhitespace: false },
          });
        } else {
          return { ok: false, snapshot, reason: "Missing selection range" };
        }
        break;

      case "insert":
        if (from != null) {
          editor.commands.insertContentAt(from, html, {
            updateSelection: true,
            parseOptions: { preserveWhitespace: false },
          });
        } else {
          return { ok: false, snapshot, reason: "Missing cursor position" };
        }
        break;

      case "full":
      default:
        editor.commands.setContent(html);
        break;
    }

    return { ok: true, snapshot };
  } catch (err) {
    // 4. Rollback on failure
    try {
      editor.commands.setContent(snapshot);
    } catch {
      // Snapshot rollback itself failed — nothing more we can do
    }
    return {
      ok: false,
      snapshot,
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Rollback to a previously saved snapshot.
 */
export function rollbackApply(editor: any, snapshot: any): boolean {
  try {
    editor.commands.setContent(snapshot);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ee/ai/utils/safe-apply.ts
git commit -m "feat(agent): add TipTap-native safe-apply utility with snapshot rollback"
```

---

### Task 2: Rewrite handleApply in agent-panel.tsx

**Files:**
- Modify: `apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx`

- [ ] **Step 1: Replace handleApply with safe-apply + undo notification**

Replace lines 44-82 (the entire `handleApply` callback) with:

```typescript
const handleApply = useCallback(async () => {
  if (!session.lastOutput || !editor) return;

  const markdown = titleEditor
    ? maybeExtractTitle(titleEditor, session.lastOutput)
    : session.lastOutput;

  const result = safeApply({
    editor,
    titleEditor,
    markdown,
    mode: "full",  // Phase B will add selection modes here
  });

  if (result.ok) {
    // Show success notification with undo action (5s window)
    notifications.show({
      message: t("Applied to page"),
      color: "green",
      autoClose: 5000,
      withCloseButton: true,
    });
    // Store snapshot for potential manual undo
    lastSnapshotRef.current = result.snapshot;
  } else {
    notifications.show({
      message: `${t("Failed to apply")}: ${result.reason}`,
      color: "red",
    });
  }
}, [session.lastOutput, editor, titleEditor, t]);
```

Add at the top of the component:
```typescript
import { safeApply } from "../../utils/safe-apply";

// Inside component, before handleApply:
const lastSnapshotRef = useRef<any>(null);
```

Remove unused imports:
```typescript
// Remove these imports (no longer needed):
// import { captureAiCreatePageSnapshot, commitDraftWithRecovery } from "../../hooks/ai-create-session.commit";
// import { creatorCommit } from "../../services/ai-service";
// import api from "@/lib/api-client";
```

Also remove `usePageQuery` and `page` from the dependency array since they're no longer used.

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx
git commit -m "feat(agent-panel): replace server-side overwrite with TipTap safe-apply"
```

---

### Task 3: Runner Reliability Fixes

**Files:**
- Modify: `agent-service/app/agent/runner.py`

- [ ] **Step 1: Fix quality retry to update all_messages_snapshot**

At line ~254, after `retry_result = await agent.run(retry_prompt, deps=deps)`, add:

```python
            retry_output = retry_result.output
            # Update conversation history with retry result
            if hasattr(retry_result, "all_messages"):
                all_messages_snapshot = retry_result.all_messages()
```

- [ ] **Step 2: Fix silent exception in read_page fallback**

At line ~102-114, replace the `except Exception: pass` with:

```python
        except Exception as e:
            logger.warning("Failed to read page content for editing fallback, thread %s: %s", deps.thread_id, e)
            yield {"type": "warning", "issues": [f"无法读取当前页面内容作为编辑参考：{e}"]}
```

- [ ] **Step 3: Fix comment numbering**

Change the second "# 6." comment (line 285) to "# 7.":

```python
    # 7. 保存对话历史
```

- [ ] **Step 4: Run agent tests**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/runner.py
git commit -m "fix(agent): retry updates conversation history, read_page fallback emits warning"
```

---

## Phase B: Selection-Based Editing

### Task 4: Selection Capture Utility

**Files:**
- Create: `apps/client/src/ee/ai/utils/editor-selection.ts`

- [ ] **Step 1: Implement selection capture with text anchoring**

```typescript
// apps/client/src/ee/ai/utils/editor-selection.ts
import { htmlToMarkdown } from "@docmost/editor-ext";

export interface EditorSelection {
  mode: "replace" | "insert" | "full";
  from: number | null;
  to: number | null;
  selectedText: string | null;
  contextBefore: string;
  contextAfter: string;
  documentOutline: string;
  // Text anchors for position verification at apply time
  anchorBefore: string;
  anchorAfter: string;
}

const CONTEXT_BLOCKS = 3;
const ANCHOR_LENGTH = 100;

/**
 * Capture the current editor selection state.
 *
 * Uses TipTap's ProseMirror state (persists even when editor loses focus).
 * Expands selection to block boundaries for clean content extraction.
 */
export function captureEditorSelection(editor: any): EditorSelection {
  if (!editor || !editor.state) {
    return emptySelection();
  }

  const { selection, doc } = editor.state;

  // No selection or editor not focused → full document mode
  if (selection.empty) {
    // Check if cursor has a meaningful position (not at doc start)
    if (selection.from > 1) {
      return captureInsertMode(editor, selection.from);
    }
    return emptySelection();
  }

  return captureReplaceMode(editor, selection.from, selection.to);
}

function emptySelection(): EditorSelection {
  return {
    mode: "full",
    from: null,
    to: null,
    selectedText: null,
    contextBefore: "",
    contextAfter: "",
    documentOutline: "",
    anchorBefore: "",
    anchorAfter: "",
  };
}

function captureReplaceMode(
  editor: any,
  rawFrom: number,
  rawTo: number,
): EditorSelection {
  const { doc } = editor.state;

  // Expand to block boundaries
  const $from = doc.resolve(rawFrom);
  const $to = doc.resolve(rawTo);
  const from = $from.start($from.depth);
  const to = $to.end($to.depth);

  // Extract selected content as markdown
  const selectedSlice = doc.slice(from, to);
  const selectedHtml = sliceToHtml(editor, selectedSlice);
  const selectedText = htmlToMarkdown(selectedHtml);

  // Extract context before (preceding blocks)
  const contextBefore = extractContext(editor, 0, from, CONTEXT_BLOCKS);
  const contextAfter = extractContext(editor, to, doc.content.size, CONTEXT_BLOCKS);

  // Document outline
  const documentOutline = extractOutline(doc);

  // Text anchors for position verification
  const fullText = doc.textBetween(0, doc.content.size);
  const anchorBefore = fullText.substring(
    Math.max(0, doc.textBetween(0, from).length - ANCHOR_LENGTH),
    doc.textBetween(0, from).length,
  );
  const anchorAfterStart = doc.textBetween(0, to).length;
  const anchorAfter = fullText.substring(
    anchorAfterStart,
    Math.min(fullText.length, anchorAfterStart + ANCHOR_LENGTH),
  );

  return {
    mode: "replace",
    from,
    to,
    selectedText,
    contextBefore,
    contextAfter,
    documentOutline,
    anchorBefore,
    anchorAfter,
  };
}

function captureInsertMode(editor: any, pos: number): EditorSelection {
  const { doc } = editor.state;

  const contextBefore = extractContext(editor, 0, pos, CONTEXT_BLOCKS);
  const contextAfter = extractContext(editor, pos, doc.content.size, CONTEXT_BLOCKS);
  const documentOutline = extractOutline(doc);

  const fullText = doc.textBetween(0, doc.content.size);
  const textBefore = doc.textBetween(0, pos);
  const anchorBefore = textBefore.substring(
    Math.max(0, textBefore.length - ANCHOR_LENGTH),
  );
  const anchorAfter = fullText.substring(
    textBefore.length,
    Math.min(fullText.length, textBefore.length + ANCHOR_LENGTH),
  );

  return {
    mode: "insert",
    from: pos,
    to: null,
    selectedText: null,
    contextBefore,
    contextAfter,
    documentOutline,
    anchorBefore,
    anchorAfter,
  };
}

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

function extractContext(
  editor: any,
  from: number,
  to: number,
  maxBlocks: number,
): string {
  if (from >= to) return "";
  try {
    const slice = editor.state.doc.slice(from, to);
    const html = sliceToHtml(editor, slice);
    const md = htmlToMarkdown(html);
    // Limit to maxBlocks worth of content
    const lines = md.split("\n");
    const blocks: string[] = [];
    let blockCount = 0;
    for (const line of lines) {
      blocks.push(line);
      if (line.trim() === "" || line.startsWith("#")) blockCount++;
      if (blockCount >= maxBlocks) break;
    }
    return blocks.join("\n");
  } catch {
    return "";
  }
}

function sliceToHtml(editor: any, slice: any): string {
  try {
    // Use ProseMirror's DOMSerializer to serialize a document fragment to HTML
    const { DOMSerializer } = require("prosemirror-model");
    const serializer = DOMSerializer.fromSchema(editor.schema);
    const div = document.createElement("div");
    const fragment = serializer.serializeFragment(slice.content);
    div.appendChild(fragment);
    return div.innerHTML;
  } catch {
    // Fallback: plain text extraction
    return slice.content.textBetween(0, slice.content.size, "\n\n");
  }
}

/**
 * Verify that stored selection positions are still valid.
 * If the document changed since capture, attempt to relocate using text anchors.
 */
export function verifyAndRelocate(
  editor: any,
  selection: EditorSelection,
): { from: number; to: number } | null {
  if (selection.from == null) return null;

  const doc = editor.state.doc;
  const fullText = doc.textBetween(0, doc.content.size);

  // Fast path: verify text at stored positions still matches
  if (selection.selectedText && selection.to != null) {
    const currentText = doc.textBetween(selection.from, Math.min(selection.to, doc.content.size));
    const expectedPreview = selection.selectedText.substring(0, 50);
    if (currentText.includes(expectedPreview)) {
      return { from: selection.from, to: selection.to };
    }
  }

  // Slow path: search using text anchors
  if (selection.anchorBefore) {
    const anchorIdx = fullText.indexOf(selection.anchorBefore);
    if (anchorIdx !== -1) {
      const newFrom = anchorIdx + selection.anchorBefore.length;
      if (selection.selectedText) {
        const selectedPreview = selection.selectedText.substring(0, 100);
        const textAfterAnchor = fullText.substring(newFrom);
        const selectedIdx = textAfterAnchor.indexOf(selectedPreview);
        if (selectedIdx !== -1) {
          const absFrom = newFrom + selectedIdx;
          // Estimate to based on original length
          const originalLength = (selection.to || 0) - (selection.from || 0);
          return { from: absFrom, to: absFrom + originalLength };
        }
      }
      // Insert mode: just return the anchor position
      if (selection.mode === "insert") {
        return { from: newFrom, to: newFrom };
      }
    }
  }

  // Cannot relocate — warn user
  return null;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ee/ai/utils/editor-selection.ts
git commit -m "feat(agent): add editor selection capture with text-anchor verification"
```

---

### Task 5: Backend — SelectionContext + Prompt Construction

**Files:**
- Modify: `agent-service/app/agent/deps.py`
- Modify: `agent-service/app/agent/runner.py`
- Modify: `agent-service/app/main.py`

- [ ] **Step 1: Add SelectionContext to deps.py**

After the `AgentDeps` class, add:

```python
@dataclass
class SelectionContext:
    """Editor selection state for targeted editing."""
    edit_mode: str = "full"
    selected_text: str = ""
    context_before: str = ""
    context_after: str = ""
    document_outline: str = ""
```

Add to `AgentDeps` after `page_content`:
```python
    selection: SelectionContext | None = None
```

- [ ] **Step 2: Update runner.py prompt construction for selection modes**

In `runner.py`, replace the page context injection block (lines 93-114) with an expanded version that handles selection modes:

```python
    # Inject context based on edit mode
    PAGE_CONTENT_LIMIT = 20_000
    edit_mode = "full"

    if deps.selection and deps.selection.edit_mode in ("replace", "insert"):
        # Selection mode: provide targeted context
        edit_mode = deps.selection.edit_mode
        parts = []
        if deps.selection.document_outline:
            parts.append(f"[DOCUMENT OUTLINE]\n{deps.selection.document_outline}\n[/DOCUMENT OUTLINE]")
        if deps.selection.context_before:
            parts.append(f"[CONTEXT BEFORE]\n{deps.selection.context_before}\n[/CONTEXT BEFORE]")
        if deps.selection.edit_mode == "replace" and deps.selection.selected_text:
            parts.append(f"[SELECTED TEXT]\n{deps.selection.selected_text}\n[/SELECTED TEXT]")
        elif deps.selection.edit_mode == "insert":
            parts.append("[CURSOR POSITION — insert content here]")
        if deps.selection.context_after:
            parts.append(f"[CONTEXT AFTER]\n{deps.selection.context_after}\n[/CONTEXT AFTER]")
        parts.append(f"User request: {user_message}")
        if multimodal_parts:
            prompt = ["\n\n".join(parts), *multimodal_parts]
        else:
            prompt = "\n\n".join(parts)
    elif skill == "editing" and deps.page_content:
        # Full document editing mode
        edit_mode = "full"
        page_text = deps.page_content[:PAGE_CONTENT_LIMIT]
        truncated_note = "\n[Document truncated]" if len(deps.page_content) > PAGE_CONTENT_LIMIT else ""
        if multimodal_parts:
            prompt = [f"[CURRENT DOCUMENT]\n{page_text}{truncated_note}\n[/CURRENT DOCUMENT]\n\n{user_message}", *multimodal_parts]
        else:
            prompt = f"[CURRENT DOCUMENT]\n{page_text}{truncated_note}\n[/CURRENT DOCUMENT]\n\n{user_message}"
    elif skill == "editing" and deps.page_id:
        # Fallback: read from database
        edit_mode = "full"
        from app.agent.tools.read_page import read_page_impl
        try:
            page_data = await read_page_impl(deps.page_id)
            if page_data.get("status") == "success":
                page_content = page_data["content"]
                if multimodal_parts:
                    prompt = [f"[CURRENT DOCUMENT]\n{page_content}\n[/CURRENT DOCUMENT]\n\n{user_message}", *multimodal_parts]
                else:
                    prompt = f"[CURRENT DOCUMENT]\n{page_content}\n[/CURRENT DOCUMENT]\n\n{user_message}"
        except Exception as e:
            logger.warning("Failed to read page for editing, thread %s: %s", deps.thread_id, e)
            yield {"type": "warning", "issues": [f"无法读取页面内容：{e}"]}
```

Also update the `<document>` marker extraction to skip for selection modes:

```python
    # Extract document content from editing output (only for full mode)
    if skill == "editing" and edit_mode == "full" and final_output:
        extracted = extract_document_content(final_output)
        if extracted != final_output:
            logger.info("Extracted document from <document> markers for thread %s", deps.thread_id)
            final_output = extracted
```

And include `edit_mode` in the done event:

```python
    yield {
        "type": "done",
        "final_content": final_output or "",
        "output_type": output_type,
        "edit_mode": edit_mode,
    }
```

- [ ] **Step 3: Update main.py to parse selection fields**

In the v2 endpoint, after `page_content` parsing, add:

```python
    # Parse selection context
    from app.agent.deps import SelectionContext
    selection = None
    edit_mode_raw = request.get("edit_mode")
    if edit_mode_raw in ("replace", "insert"):
        selection = SelectionContext(
            edit_mode=edit_mode_raw,
            selected_text=request.get("selected_text", ""),
            context_before=request.get("context_before", ""),
            context_after=request.get("context_after", ""),
            document_outline=request.get("document_outline", ""),
        )

    deps = AgentDeps(
        ...,
        selection=selection,
    )
```

- [ ] **Step 4: Run all agent tests**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/deps.py agent-service/app/agent/runner.py agent-service/app/main.py
git commit -m "feat(agent): selection context in deps, prompt construction for replace/insert/full modes"
```

---

### Task 6: Editing Skill — Selection Mode Instructions

**Files:**
- Modify: `agent-service/app/agent/skills/editing.py`

- [ ] **Step 1: Add selection mode and insert mode sections**

After the Tool Usage section in `_EDITING_CORE`, add:

```python
# Add before the closing triple-quote of _EDITING_CORE:

## Selection-Based Editing

When you receive [SELECTED TEXT] markers, you are editing a specific section:

- [DOCUMENT OUTLINE]: The document's heading structure (for context)
- [CONTEXT BEFORE]: Text immediately before the selection
- [SELECTED TEXT]: The content the user selected — your output REPLACES this
- [CONTEXT AFTER]: Text immediately after the selection

### Output Rules for Selection Mode

- Output ONLY the replacement content for the selected section
- Do NOT output the full document — only the replacement
- Do NOT include [CONTEXT BEFORE] or [CONTEXT AFTER] in your output
- Do NOT wrap output in <document> tags (only needed for full-document mode)
- Ensure your output connects naturally with the surrounding context
- Match the formatting style of the surrounding content

### When You Need More Context

If the provided outline and surrounding context are insufficient to make a
well-informed edit, call `read_page` (with no arguments) to read the full
current page. Only do this when genuinely needed.

## Cursor Insertion

When you receive [CURSOR POSITION] instead of [SELECTED TEXT], the user
wants to INSERT content at that position:

- Output a focused content block (1-5 paragraphs, a table, or a code block)
  that fits naturally between the surrounding context
- Do NOT output the full document — only the content to insert
- Do NOT wrap output in <document> tags
- Match the formatting style and heading level of the surrounding content
```

- [ ] **Step 2: Run skill tests**

```bash
cd agent-service && python -m pytest tests/agent/test_skills/ -v --tb=short
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/agent/skills/editing.py
git commit -m "feat(agent): add selection-mode and insert-mode instructions to editing skill"
```

---

### Task 7: NestJS Gateway — Pass Selection Fields

**Files:**
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`

- [ ] **Step 1: Add selection fields to buildV2RunPayload**

```typescript
// Add to params type:
editMode?: string;
selectedText?: string;
contextBefore?: string;
contextAfter?: string;
documentOutline?: string;

// Add to return object:
edit_mode: params.editMode || undefined,
selected_text: params.selectedText || undefined,
context_before: params.contextBefore || undefined,
context_after: params.contextAfter || undefined,
document_outline: params.documentOutline || undefined,
```

- [ ] **Step 2: Update controller to extract selection fields from request body**

In the v2/run handler, extract the new fields from `body` and pass them to `buildV2RunPayload`.

- [ ] **Step 3: TypeScript compilation check**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "feat(gateway): pass selection editing fields in v2 payload"
```

---

### Task 8: Frontend Types + Service + Hook

**Files:**
- Modify: `apps/client/src/ee/ai/types/agent-v2.types.ts`
- Modify: `apps/client/src/ee/ai/services/agent-v2-service.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-agent-session.ts`

- [ ] **Step 1: Update types**

```typescript
// Done event — add edit_mode:
| { type: "done"; final_content?: string; output_type?: "document" | "conversation"; edit_mode?: "replace" | "insert" | "full" }

// AgentV2RunRequest — add selection fields:
export interface AgentV2RunRequest {
  prompt: string;
  pageId?: string;
  threadId?: string;
  pageContent?: string;
  editMode?: "replace" | "insert" | "full";
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  documentOutline?: string;
  files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
}

// AgentSessionAPI — add editMode + selection:
export interface AgentSessionAPI {
  messages: AgentMessage[];
  status: AgentSessionStatus;
  threadId: string | null;
  lastOutput: string | null;
  outputType: "document" | "conversation" | null;
  editMode: "replace" | "insert" | "full" | null;
  submit: (prompt: string, files?: File[], pageContent?: string, selection?: any) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}
```

- [ ] **Step 2: Update agent-v2-service.ts**

Add selection fields to params and request body:

```typescript
// In agentV2Run params:
selection?: {
  editMode: string;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  documentOutline?: string;
};

// In body construction:
editMode: params.selection?.editMode,
selectedText: params.selection?.selectedText,
contextBefore: params.selection?.contextBefore,
contextAfter: params.selection?.contextAfter,
documentOutline: params.selection?.documentOutline,
```

- [ ] **Step 3: Update use-agent-session.ts**

Add `editMode` state, handle `edit_mode` from done event, accept selection in submit:

```typescript
const [editMode, setEditMode] = useState<"replace" | "insert" | "full" | null>(null);

// In handleEvent "done" case:
setEditMode((event as any).edit_mode || "full");

// In submit():
// Accept selection parameter and forward to agentV2Run
const submit = useCallback(
  async (prompt: string, files?: File[], pageContent?: string, selection?: any) => {
    // ... existing code ...
    abortRef.current = agentV2Run(
      {
        prompt, pageId, threadId: threadId ?? undefined,
        pageContent,
        selection,
        files,
      },
      handleEvent, onError, onComplete,
    );
  },
  [...deps],
);

// In reset():
setEditMode(null);

// Return editMode from hook
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/types/ apps/client/src/ee/ai/services/ apps/client/src/ee/ai/hooks/
git commit -m "feat(agent): selection editing types, service, and hook integration"
```

---

### Task 9: Frontend Panel — Selection Capture + Mode Indicator + Apply Routing

**Files:**
- Modify: `apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx`

- [ ] **Step 1: Add selection tracking and mode indicator**

Add to imports:
```typescript
import { captureEditorSelection, verifyAndRelocate, type EditorSelection } from "../../utils/editor-selection";
import { IconCursorText } from "@tabler/icons-react";
```

Add selection state inside the component (using useState for reactivity, not just ref):
```typescript
const [currentSelection, setCurrentSelection] = useState<EditorSelection | null>(null);

// Track editor selection continuously — useState triggers re-render for mode indicator
useEffect(() => {
  if (!editor) return;
  const handler = () => {
    const sel = editor.state.selection;
    if (!sel.empty) {
      setCurrentSelection(captureEditorSelection(editor));
    }
  };
  editor.on("selectionUpdate", handler);
  return () => { editor.off("selectionUpdate", handler); };
}, [editor]);
```

- [ ] **Step 2: Update handleSubmit to include selection data**

```typescript
const handleSubmit = useCallback(
  (prompt: string, files?: File[]) => {
    const selection = currentSelection;
    const pageContent = session.threadId
      ? getPageContent()
      : (selection && selection.mode !== "full" ? undefined : undefined);

    session.submit(
      prompt,
      files,
      selection?.mode === "full" ? getPageContent() : undefined,
      selection?.mode !== "full" ? {
        editMode: selection?.mode,
        selectedText: selection?.selectedText,
        contextBefore: selection?.contextBefore,
        contextAfter: selection?.contextAfter,
        documentOutline: selection?.documentOutline,
      } : undefined,
    );

    // Clear selection after submit
    currentSelection = null;
  },
  [session.threadId, session.submit, getPageContent],
);
```

- [ ] **Step 3: Update handleApply for three modes**

Replace handleApply to use `session.editMode` and `selectionRef`:

```typescript
const handleApply = useCallback(async () => {
  if (!session.lastOutput || !editor) return;

  const markdown = titleEditor
    ? maybeExtractTitle(titleEditor, session.lastOutput)
    : session.lastOutput;

  let applyMode: "full" | "replace" | "insert" = session.editMode || "full";
  let from: number | undefined;
  let to: number | undefined;

  // For selection modes, verify positions are still valid
  if (applyMode !== "full" && currentSelection) {
    const relocated = verifyAndRelocate(editor, currentSelection);
    if (relocated) {
      from = relocated.from;
      to = relocated.to;
    } else {
      notifications.show({
        message: t("Document changed since selection. Applying as full document."),
        color: "yellow",
      });
      applyMode = "full";
    }
  }

  const result = safeApply({ editor, titleEditor, markdown, mode: applyMode, from, to });

  if (result.ok) {
    lastSnapshotRef.current = result.snapshot;
    notifications.show({ message: t("Applied to page"), color: "green", autoClose: 5000 });
  } else {
    notifications.show({ message: `${t("Failed to apply")}: ${result.reason}`, color: "red" });
  }
}, [session.lastOutput, session.editMode, editor, titleEditor, t]);
```

- [ ] **Step 4: Add mode indicator above input bar**

Before `<InputBar>` in the JSX:

```tsx
{currentSelection && currentSelection.mode !== "full" && (
  <Group gap={6} px="sm" py={4} style={{ borderTop: "1px solid var(--mantine-color-gray-2)" }}>
    <IconCursorText size={14} style={{ color: "#6366f1" }} />
    <Text size="xs" c="dimmed">
      {currentSelection.mode === "replace"
        ? t("Editing selected content")
        : t("Inserting at cursor")}
    </Text>
    <ActionIcon
      size="xs"
      variant="subtle"
      onClick={() => setCurrentSelection(null)}
    >
      <IconX size={10} />
    </ActionIcon>
  </Group>
)}
```

- [ ] **Step 5: TypeScript check + commit**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
git add apps/client/src/ee/ai/
git commit -m "feat(agent-panel): selection capture, mode indicator, three-mode Apply routing"
```

---

## Phase C: System Hardening

### Task 10: V2 Task Registration for Server-Side Cancellation

**Files:**
- Modify: `agent-service/app/main.py`

- [ ] **Step 1: Register/unregister tasks in v2 endpoint**

In `run_agent_v2`, wrap the event generator with task registration:

```python
    from app.agent.cancellation import register_in_memory_task, unregister_in_memory_task
    import uuid

    task_id = str(uuid.uuid4())

    async def event_generator():
        register_in_memory_task(task_id, thread_id)
        try:
            yield {"data": json.dumps({"type": "session", "thread_id": thread_id}, ensure_ascii=False)}
            async for event in _run_agent(user_message, deps, multimodal_parts=multimodal_parts or None):
                yield {"data": json.dumps(event, ensure_ascii=False)}
        finally:
            unregister_in_memory_task(task_id, thread_id)
```

- [ ] **Step 2: Run tests + commit**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short 2>&1 | tail -10
git add agent-service/app/main.py
git commit -m "fix(agent): register v2 tasks for server-side cancellation support"
```

---

### Task 11: Editor Unlock Safety

**Files:**
- Modify: `apps/client/src/ee/ai/hooks/use-agent-session.ts`

- [ ] **Step 1: Add cleanup effect to unlock editor on unmount**

```typescript
// Inside useAgentSession, add after lockEditor/unlockEditor definitions:
useEffect(() => {
  return () => {
    // Ensure editor is unlocked if component unmounts during streaming
    unlockEditor();
  };
}, [unlockEditor]);
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
git add apps/client/src/ee/ai/hooks/use-agent-session.ts
git commit -m "fix(agent): ensure editor unlock on hook unmount"
```

---

## Task 12: Full Regression

- [ ] **Step 1: Python tests**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short
```

Expected: All tests pass.

- [ ] **Step 2: TypeScript compilation**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

Expected: Zero errors.

- [ ] **Step 3: Summary commit**

```bash
git add -A && git status
# Only commit if there are uncommitted changes
```
