# Selection-Based Editing & Apply Safety Design

> **Status**: Draft
> **Date**: 2026-03-28
> **Scope**: Agent v2 editing experience — selection-driven edits, safe Apply mechanism, read_page context tool

---

## Problem Statement

The current Agent editing flow has three architectural defects:

1. **Blind full-page overwrite**: "Apply to page" calls `commitDraftWithRecovery` with `insertMode: "overwrite"`, replacing the entire page. When the agent outputs a partial edit or malformed content, the entire document is destroyed.

2. **No edit scope signal**: The agent receives the full document but has no signal about WHICH PART the user wants to edit. It guesses from the prompt, often incorrectly.

3. **Markdown rendering bypass**: The server-side commit API sometimes fails to convert complex markdown (mermaid blocks, nested tables) to TipTap format, resulting in raw markdown displayed in the editor.

## Design Goals

- Users can select text in the editor to scope their edit request
- Apply replaces only the selected range, leaving the rest untouched
- No selection = full document mode (current behavior, but safer)
- Agent can request broader context via `read_page` tool when needed
- All Apply operations go through TipTap's frontend pipeline (not server-side API)
- Pre-Apply snapshot enables one-click rollback

## Non-Goals

- Diff preview with per-change accept/reject (Phase 3, not this spec)
- Claude Artifacts-style `old_str`/`new_str` structured operations (future consideration)
- Real-time streaming into the editor (requires TipTap Content AI license evaluation)

---

## Architecture

### Three Editing Modes

```
┌─────────────────────────────────────────────────┐
│                 User Action                      │
├────────────┬────────────────┬────────────────────┤
│ Has text   │ Cursor only    │ No selection/      │
│ selection  │ (empty sel.)   │ no cursor focus     │
├────────────┼────────────────┼────────────────────┤
│ REPLACE    │ INSERT         │ FULL DOCUMENT      │
│ mode       │ mode           │ mode               │
├────────────┼────────────────┼────────────────────┤
│ Agent gets:│ Agent gets:    │ Agent gets:        │
│ selected   │ context around │ full document      │
│ text +     │ cursor +       │ content            │
│ context    │ outline        │                    │
├────────────┼────────────────┼────────────────────┤
│ Apply:     │ Apply:         │ Apply:             │
│ insertAt   │ insertAt       │ setContent         │
│ {from, to} │ {pos}          │ (full replace)     │
└────────────┴────────────────┴────────────────────┘
```

### Data Flow

```
Frontend                          Backend (Python)
────────                          ────────────────
1. User selects text in editor
   ↓
2. Opens Agent panel / focuses input
   ↓
3. captureSelection() saves:
   - mode: "replace" | "insert" | "full"
   - from/to positions (ProseMirror)
   - selectedText (as markdown)
   - contextBefore (2-3 blocks)
   - contextAfter (2-3 blocks)
   - documentOutline (headings)
   ↓
4. UI shows mode indicator:
   "编辑选中内容 (2段)" or
   "在光标位置插入" or
   "编辑整个文档"
   ↓
5. User types prompt, hits Send
   ↓
6. submit() sends:                → 7. Python receives request:
   { prompt, pageId, threadId,       { prompt, page_id, thread_id,
     editMode, selectedText,           edit_mode, selected_text,
     contextBefore, contextAfter,      context_before, context_after,
     documentOutline,                  document_outline,
     pageContent (full mode only) }    page_content }
                                    ↓
                                  8. runner.py routes:
                                     - edit_mode="replace"/"insert" →
                                       editing skill + selection context
                                     - edit_mode="full" →
                                       editing skill + full document
                                     - no edit_mode →
                                       creation skill (first turn)
                                    ↓
                                  9. Agent executes:
                                     - Selection mode: outputs replacement
                                       for selected section
                                     - Full mode: outputs complete document
                                       in <document> tags
                                     - Calls read_page if needs more context
                                    ↓
10. Frontend receives             ← done event:
    final_content + output_type      { final_content, output_type,
    + edit_mode                        edit_mode }
    ↓
11. handleApply():
    - Save snapshot (editor.getJSON())
    - if edit_mode == "replace":
        html = markdownToHtml(final_content)
        editor.commands.insertContentAt({from, to}, html)
    - if edit_mode == "insert":
        html = markdownToHtml(final_content)
        editor.commands.insertContentAt(pos, html)
    - if edit_mode == "full":
        html = markdownToHtml(final_content)
        editor.commands.setContent(html)
    - All go through ProseMirror → y-prosemirror → Yjs
```

---

## Component Design

### 1. Selection Capture (Frontend)

**Location**: New utility, used by `agent-panel.tsx`

```typescript
interface EditorSelection {
  mode: "replace" | "insert" | "full";
  from: number | null;        // ProseMirror position
  to: number | null;          // ProseMirror position
  selectedText: string | null;  // Markdown of selected content
  contextBefore: string;      // 2-3 blocks before selection as markdown
  contextAfter: string;       // 2-3 blocks after selection as markdown
  documentOutline: string;    // Heading structure of full document
}
```

**Capture logic**:
- Called when user focuses the Agent input bar
- If `editor.state.selection.empty === false` → REPLACE mode
  - Expand selection to block boundaries (`$from.start()`, `$to.end()`)
  - Extract selected nodes as HTML → `htmlToMarkdown()`
  - Extract 2-3 preceding block nodes as context
  - Extract 2-3 following block nodes as context
- If `editor.state.selection.empty === true` and editor is focused → INSERT mode
  - No selected text
  - Extract surrounding context
- If editor has no focus or panel opened without editor interaction → FULL mode
  - Full document content via `htmlToMarkdown(editor.getHTML())`

**Document outline extraction**:
```typescript
function getDocumentOutline(editor): string {
  const headings: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level;
      const text = node.textContent;
      headings.push("#".repeat(level) + " " + text);
    }
  });
  return headings.join("\n");
}
```

### 2. Request Format Changes

**AgentV2RunRequest** (TypeScript + Python):

```typescript
interface AgentV2RunRequest {
  prompt: string;
  pageId?: string;
  threadId?: string;
  // Existing
  pageContent?: string;        // Full document (full mode only)
  files?: FilePayload[];
  // New: selection editing
  editMode?: "replace" | "insert" | "full";
  selectedText?: string;       // Markdown of selected content
  selectionFrom?: number;      // ProseMirror start position
  selectionTo?: number;        // ProseMirror end position
  contextBefore?: string;      // Preceding blocks as markdown
  contextAfter?: string;       // Following blocks as markdown
  documentOutline?: string;    // Heading structure
}
```

**NestJS gateway**: Pass through all new fields (snake_case conversion).

**Python endpoint**: Parse new fields into `AgentDeps` or pass as prompt context.

### 3. AgentDeps Changes

Add a new dataclass for selection context:

```python
@dataclass
class SelectionContext:
    """Editor selection state for targeted editing."""
    edit_mode: str = "full"       # "replace" | "insert" | "full"
    selected_text: str = ""       # Markdown of selected content
    selection_from: int | None = None  # ProseMirror position
    selection_to: int | None = None    # ProseMirror position
    context_before: str = ""      # Preceding blocks
    context_after: str = ""       # Following blocks
    document_outline: str = ""    # Heading structure
```

Add to `AgentDeps`:
```python
    selection: SelectionContext | None = None
```

### 4. Runner Changes — Prompt Construction

In `runner.py`, after skill selection, construct the prompt based on edit mode:

```python
if deps.selection and deps.selection.edit_mode in ("replace", "insert"):
    # Selection mode: provide targeted context
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
    prompt = "\n\n".join(parts)

elif skill == "editing" and deps.page_content:
    # Full document mode (existing behavior)
    prompt = f"[CURRENT DOCUMENT]\n{page_text}\n[/CURRENT DOCUMENT]\n\n{user_message}"
```

### 5. Editing Skill — Selection Mode Instructions

Add to `editing.py` after the existing full-document section:

```
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
- Ensure your output connects naturally with the surrounding context
- Match the formatting style of the surrounding content
- Wrap your output in <document> tags (same as full document mode)

### When You Need More Context

If the provided outline and surrounding context are insufficient to make a
well-informed edit, call `read_page` (with no arguments) to read the full
current page. Only do this when genuinely needed — most selection edits
have enough context from the surrounding blocks.

## Cursor Insertion

When you receive [CURSOR POSITION] instead of [SELECTED TEXT], the user
wants to INSERT content at that position:

- Output a focused content block (1-5 paragraphs, a table, or a code block)
  that fits naturally between the surrounding context
- Do NOT output the full document — only the content to insert
- Match the formatting style and heading level of the surrounding content
- Do not include surrounding context in your output

## `<document>` Tags in Selection/Insert Modes

In selection and insert modes, do NOT wrap your output in `<document>` tags.
Output the replacement/insertion content directly — no tags, no framing.

`<document>` tags are ONLY used in full-document mode where conversational
framing separation is needed.
```

### 6. Apply Mechanism — Frontend Safety

**Replace `handleApply` in `agent-panel.tsx`**:

```typescript
const handleApply = useCallback(async () => {
  if (!session.lastOutput || !editor) return;

  // 1. Save snapshot for rollback
  const snapshot = editor.getJSON();

  try {
    const markdown = session.lastOutput;
    const html = markdownToHtml(preprocessImagesForEditor(markdown));

    if (session.editMode === "replace" && selectionRef.current) {
      // Selection replace: only affect the selected range
      const { from, to } = selectionRef.current;
      editor.commands.insertContentAt({ from, to }, html, {
        updateSelection: true,
      });
    } else if (session.editMode === "insert" && selectionRef.current) {
      // Cursor insert: insert at position
      const { from } = selectionRef.current;
      editor.commands.insertContentAt(from, html);
    } else {
      // Full document: replace everything
      editor.commands.setContent(html);
    }

    notifications.show({ message: t("Applied to page"), color: "green" });
  } catch (err) {
    // Rollback on failure
    editor.commands.setContent(snapshot);
    notifications.show({ message: t("Failed to apply, reverted"), color: "red" });
  }
}, [session.lastOutput, session.editMode, editor, t]);
```

**Key changes**:
- Uses `editor.commands.insertContentAt()` for selection modes (not server API)
- Uses `editor.commands.setContent()` for full mode (not server API)
- All go through TipTap/ProseMirror pipeline → proper rendering guaranteed
- Snapshot before apply → rollback on failure
- No more `commitDraftWithRecovery` with `insertMode: "overwrite"`

### 7. UI Mode Indicator

In `agent-panel.tsx`, show the current editing mode above the input bar:

```tsx
{selectionInfo && selectionInfo.mode !== "full" && (
  <Group gap={6} px="sm" py={4}>
    <IconCursorText size={14} color="#6366f1" />
    <Text size="xs" c="dimmed">
      {selectionInfo.mode === "replace"
        ? t("Editing selected content")
        : t("Inserting at cursor position")}
    </Text>
    <ActionIcon
      size="xs"
      variant="subtle"
      onClick={() => clearSelection()}
    >
      <IconX size={12} />
    </ActionIcon>
  </Group>
)}
```

Users can click X to switch to full document mode.

### 8. Done Event — Pass edit_mode Back

The done event needs `edit_mode` so the frontend knows how to Apply:

```python
yield {
    "type": "done",
    "final_content": final_output or "",
    "output_type": output_type,
    "edit_mode": deps.selection.edit_mode if deps.selection else "full",
}
```

---

## Edge Cases & Mitigations

| Edge Case | Mitigation |
|-----------|------------|
| Selection spans partial blocks | Expand to nearest block boundaries before capture |
| Selection lost on input focus | Capture via `onSelectionUpdate` into ref BEFORE blur (see below) |
| ProseMirror positions stale (concurrent edit) | Text-anchor matching at apply time (see below) |
| Agent output doesn't fit the selection context | Fallback to full output |
| Very long selection (5000+ words) | Treat as full document mode if selected > 80% of document |
| Agent needs more context than provided | `read_page` tool available; editing skill instructs agent to use it |
| markdownToHtml fails on complex content | try/catch with snapshot rollback |
| User selects content, switches pages, comes back | Clear selection state on page navigation |
| INSERT mode output too long/short | Skill instructs "1-5 paragraphs that fit naturally" |

### Critical: Selection Capture Timing

TipTap blurs the editor when the input bar receives focus, which can clear the visual selection. The solution:

```typescript
// Use TipTap's onSelectionUpdate to continuously track the last non-empty selection
const lastSelectionRef = useRef<EditorSelection | null>(null);

useEffect(() => {
  if (!editor) return;
  const handler = () => {
    const sel = editor.state.selection;
    if (!sel.empty) {
      lastSelectionRef.current = captureSelection(editor);
    }
  };
  editor.on("selectionUpdate", handler);
  return () => editor.off("selectionUpdate", handler);
}, [editor]);

// When user focuses input bar, use lastSelectionRef.current (not live selection)
```

This captures the selection BEFORE the editor loses focus, avoiding the blur-clears-selection problem.

### Critical: Position Stability for Concurrent Edits

Stored ProseMirror `from`/`to` positions become invalid if the document is modified between selection capture and Apply. Using raw positions would corrupt the document in collaborative scenarios.

**Solution: Text-anchor matching at apply time.**

Instead of storing raw positions, store the **selected text content** and a few surrounding characters as anchors:

```typescript
interface SelectionAnchor {
  // Raw positions (for non-collaborative fast path)
  from: number;
  to: number;
  // Text anchors (for robust matching at apply time)
  selectedTextPreview: string;   // First 200 chars of selected text
  anchorBefore: string;          // Last 100 chars before selection
  anchorAfter: string;           // First 100 chars after selection
}
```

At apply time:
1. Try raw positions first (fast path — works when no concurrent edits)
2. Verify the text at `from..to` still matches `selectedTextPreview`
3. If mismatch → search the document for `anchorBefore + selectedTextPreview`
4. If found → recalculate correct positions and apply there
5. If not found → warn user: "Document changed, please reselect"

This is the same approach as Codex V4A's context-line anchoring — robust to concurrent edits without requiring complex position mapping.

### Post-Apply Undo Notification

After Apply, show a transient notification (5 seconds) with an "Undo" action:

```tsx
notifications.show({
  message: t("Applied to page"),
  color: "green",
  autoClose: 5000,
  action: {
    label: t("Undo"),
    onClick: () => {
      editor.commands.setContent(snapshot);
      notifications.show({ message: t("Reverted"), color: "blue" });
    },
  },
});
```

This provides a safety net similar to Gmail's "Undo Send".

---

## Backward Compatibility

| Aspect | Impact |
|--------|--------|
| First-turn creation | Unchanged — no selection, no edit_mode, creation skill |
| Existing full-document editing | Works as before — edit_mode="full" is the default |
| SSE protocol | Additive — `edit_mode` is a new optional field in done event |
| Request format | Additive — all new fields are optional |
| v1 orchestrator | Not affected — v2 endpoint only |

---

## Implementation Sequence

### Phase A: Apply Safety (can ship independently)
1. **Frontend Apply**: Replace `commitDraftWithRecovery` with TipTap `setContent()` + snapshot rollback + undo notification
2. **Runner fix**: Quality retry updates `all_messages_snapshot` for conversation consistency
3. **Runner fix**: Silent exceptions in read_page fallback emit warning events instead of swallowing

### Phase B: Selection-Based Editing
4. **Backend**: Add `SelectionContext` to deps, update runner prompt construction, pass `edit_mode` in done event
5. **Backend**: Selection mode prompt construction (outline + context + selected_text)
6. **Backend**: Skip `<document>` marker extraction for selection/insert modes
7. **Editing skill**: Add selection-mode + insert-mode instructions + `read_page` context guidance
8. **NestJS gateway**: Pass through new fields
9. **Frontend types**: Add new fields to request/response types
10. **Frontend selection capture**: `onSelectionUpdate` continuous tracking + text-anchor storage
11. **Frontend Apply**: Three-mode routing (replace/insert/full) with text-anchor verification
12. **Frontend UI**: Mode indicator above input bar with clear/switch button
13. **Tests**: Selection capture, prompt construction, Apply modes, text-anchor matching

### Phase C: System Hardening (parallel with B)
14. **V2 cancellation**: Register/unregister tasks in v2 endpoint for server-side cancellation
15. **V2 input validation**: Add Pydantic request model with field validation + max lengths
16. **Editor unlock safety**: Cleanup effect on hook unmount to prevent permanent lock

## Global Architecture Review Findings

The following systemic issues were identified during global review and should be
addressed alongside or before this spec's implementation:

| ID | Severity | Component | Issue | Phase |
|----|----------|-----------|-------|-------|
| A-1 | High | main.py v2 endpoint | V2 does not register tasks for server-side cancellation | C |
| A-7 | Medium | runner.py retry | Quality retry doesn't update all_messages_snapshot | A |
| B-1 | Critical | agent-panel.tsx | Full-page overwrite without persistent undo | A |
| B-2 | Medium | use-agent-session.ts | Editor lock without guaranteed unlock on unmount | C |
| C-1 | Medium | runner.py | Silent exception swallowing in read_page fallback | A |
| C-4 | Medium | main.py v2 endpoint | No Pydantic request validation model | C |
| D-1 | High | Selection spec | Position staleness in collaborative editing | B |
| D-2 | Medium | Selection spec | Selection capture must precede editor blur | B |

Overall system reliability: **6.5/10** → target **8/10** after Phase A+B+C.
