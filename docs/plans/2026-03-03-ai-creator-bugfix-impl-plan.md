# AI Creator Bug修复实施计划

> **对于Claude：** 必须使用的子技能：使用超能力：executing-plans来逐个任务地实施该计划。

**目标：** 修复 AI Creator 模块中的 10 个已识别错误 (P0-P3)，涵盖选择安全性、错误恢复、代码复制、流可靠性、安全强化和代码质量。

**架构：** 跨 7 个文件的增量修复。首先是基础任务（共享实用程序、类型帮助程序），然后是关键修复，然后是完善。没有新的依赖项。所有更改都是向后兼容的。

**技术栈：** React 18 + TypeScript + Jotai + TipTap/ProseMirror + Mantine + NestJS/Fastify

---

### 任务 1：创建 shared utility functions (P3-1)

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-utils.ts`

**第 1 步：创建utils文件**

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

**第 2 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-utils.ts
git commit -m "refactor(ai): extract shared utils (extractTitle, stripTimestamp, isSelectionStillValid)"
```

---

### 任务 2：添加 SelectionSnapshot type + Jotai helper (P3-2)

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`（在第8行后添加SelectionSnapshot）
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`（添加 useNullableAtom 助手）

**第 1 步：将 SelectionSnapshot 添加到类型**

在 `ai-creator.types.ts` 中的 `AiCreatorMessage` 接口（第 8 行）之后，添加：

```typescript
export interface SelectionSnapshot {
  text: string;
  from: number;
  to: number;
}
```

**步骤 2：向atoms 添加 useNullableAtom 帮助器**

在 `ai-creator-atoms.ts` 中，在现有导入后的顶部添加：

```typescript
import { atom, useAtom } from 'jotai';
import type { WritableAtom } from 'jotai';
```

然后在文件底部添加：

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

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts
git commit -m "refactor(ai): add SelectionSnapshot type and useNullableAtom helper"
```

---

### 任务 3：Fix on完成 double-call in SSE streaming (P1-4)

**文件：**
- 修改：`apps/client/src/ee/ai/services/ai-service.ts`

**第 1 步：向 `generateAiContentStream` 添加幂等性防护**

在 `generateAiContentStream`（第 40 行）中，在第 41 行的 `try {` 之后添加 `let completed = false;`。

然后更改 `[DONE]` 处理程序（第 77-80 行）：
```typescript
if (data === "[DONE]") {
  if (!completed) { completed = true; onComplete?.(); }
  return;
}
```

并在 while 循环之后更改后备 onComplete（第 94 行）：
```typescript
if (!completed) { completed = true; onComplete?.(); }
```

**第 2 步：将相同的防护添加到`creatorGenerate`**

在 `creatorGenerate`（第 116 行）中，在第 117 行的 `try {` 之后添加 `let completed = false;`。

更改 `[DONE]` 处理程序（第 160-163 行）：
```typescript
if (sseData === "[DONE]") {
  if (!completed) { completed = true; onComplete?.(); }
  return;
}
```

在 while 循环后更改后备 onComplete（第 177 行）：
```typescript
if (!completed) { completed = true; onComplete?.(); }
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/services/ai-service.ts
git commit -m "fix(ai): prevent onComplete double-call in SSE streaming"
```

---

### 任务 4：Fix code copy button + DOMPurify URI restriction (P1-1, P2-2)

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css`

**第 1 步：更新导入 — 使用共享实用程序**

在 `ai-creator-message-item.tsx` 中，将本地 `extractTitle` 和 `stripTimestamp` 定义（第 76-88 行）替换为导入：

```typescript
import { extractTitle, stripTimestamp } from './ai-creator-utils';
```

删除第 76-88 行（两个函数体）。

**步骤 2：将复制按钮添加到 bubbleMarked 代码渲染器**

将第 26-39 行（代码渲染器）替换为：

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

**步骤 3：更新 DOMPurify 配置**

将第 44-55 行 (PURIFY_CONFIG) 替换为：

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

**第 4 步：添加代码复制按钮CSS**

在 `ai-creator.module.css` 中的 `.aiContent :global(pre.code-block-wrapper)` 块之后（第 244 行之后），添加：

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

**第 5 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css
git commit -m "fix(ai): add code copy button, restrict DOMPurify URIs, use shared utils"
```

---

### 任务 5：Fix selection safety + error cleanup + history context + stop cleanup (P0-1, P0-2, P1-2, P1-3, P3-1, P3-2)

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

这是最大的变化。所有修复都在一个文件中，因此将它们合并起来以避免合并冲突。

**第 1 步：更新导入**

将第 1-48 行替换为更新的导入。主要变化：
- Add `import { extractTitle, stripTimestamp, isSelectionStillValid } from './ai-creator-utils';`
- Add `import { SelectionSnapshot } from './ai-creator.types';`
- 将可空原子的 `useAtom` 替换为原子文件中的 `useNullableAtom`
- 删除本地 `extractTitle` 函数（第 54-60 行）
- 删除本地 `renderMarkdownToEditorHtml` 保留（第 62-64 行，保持原样 - 这是一个单行包装）

具体来说，更改第 15-16 行导入：
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

在其他进口附近添加：
```typescript
import { extractTitle, isSelectionStillValid } from './ai-creator-utils';
import type { SelectionSnapshot } from './ai-creator.types';
```

删除本地 `extractTitle` 函数（第 54-60 行）。

**步骤 2：用 useNullableAtom 替换可空原子类型断言**

替换第 73-74 行：
```typescript
// OLD:
const [template, _setTemplate] = useAtom(aiCreatorTemplateAtom);
const setTemplate = _setTemplate as (v: string | null) => void;
// NEW:
const [template, setTemplate] = useNullableAtom(aiCreatorTemplateAtom);
```

替换第 79-80 行：
```typescript
// OLD:
const [autoInsert, _setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
const setAutoInsert = _setAutoInsert as (v: boolean) => void;
// NEW:
const [autoInsert, setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
```

注意：`aiCreatorAutoInsertAtom` 是不可为空的 `atomWithWebStorage<boolean>`，因此常规 `useAtom` 有效。只有 `aiCreatorTemplateAtom`（类型 `string | null`）需要帮助程序。

**第 3 步：添加removeLastEmptyAssistant助手**

在 `updateLastMessage` 之后（第 123 行之后），添加：

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

**第 4 步：修复handleStop以清理空消息**

替换第 140-143 行：

```typescript
  const handleStop = () => {
    abortRef.current?.abort();
    removeLastEmptyAssistant();
    setIsStreaming(false);
  };
```

**第 5 步：在handleSubmit中添加选择快照捕获**

在第 182 行（`const startTime = Date.now();`）之后，添加：

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

**第 6 步：修复历史记录构建以包括选择上下文**

替换第 193-201 行（历史构建块）：

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

**第 7 步：修复onError以清理空消息**

替换第 220-223 行：

```typescript
        (error) => {
          removeLastEmptyAssistant();
          notifications.show({ color: "red", message: error.error });
          setIsStreaming(false);
        },
```

**步骤 8：通过选择快照验证修复自动插入**

替换第 240-278 行（onComplete 内的自动插入块）。关键的更改是使用 `selectionSnapshot` 而不是 `selectionRange` 并在替换之前进行验证：

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

**步骤 9：修复 catch 块以清理空消息**

替换第 286-289 行：

```typescript
    } catch (error: any) {
      removeLastEmptyAssistant();
      notifications.show({ color: "red", message: error.message });
      setIsStreaming(false);
    }
```

**第 10 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx
git commit -m "fix(ai): selection snapshot validation, error cleanup, history context, nullable atom helper"
```

---

### 任务 6：Backend history message length limit (P2-1)

**文件：**
- 修改：`apps/server/src/ee/ai/ai.controller.ts`

**第 1 步：添加内容长度限制**

替换第 172-184 行（历史解析块）：

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

主要变化：
- 添加了 `typeof m.content === 'string'` 类型检查
- 添加了 `.slice(0, 10000)` 每条消息的内容限制
- 将 `.slice(-10)` 移至 `.map()` 之后，以实现更清洁的管道

**第 2 步：承诺**

```bash
git add apps/server/src/ee/ai/ai.controller.ts
git commit -m "fix(ai): limit history message content length to prevent cost attacks"
```

---

### 任务 7：验证并最终提交

**第 1 步：运行 TypeScript 编译检查**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/client/tsconfig.json 2>&1 | head -30
```

预期：没有与修改的文件相关的错误。来自其他文件的警告是可以的。

**第 2 步：运行后端 TypeScript 检查**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/server/tsconfig.json 2>&1 | head -30
```

预期：没有与 `ai.controller.ts` 相关的错误。

**第 3 步：目视验证清单**

启动开发服务器并手动验证：
- [ ] 将鼠标悬停在 AI 消息中的代码块上时出现代码复制按钮
- [ ] 单击复制按钮将代码复制到剪贴板
- [ ] 停止流会删除空的助手消息
- [ ] 网络错误不会留下空气泡
- [ ] 如果编辑器内容在流式传输期间发生更改，则会出现“选择已更改”通知
- [ ] 具有可为空原子的模板选择可以正常工作，不会出现类型错误

**第 4 步：如果没有错误，则创建摘要提交**

如果修复了任何编译问题：
```bash
git add -A
git commit -m "fix(ai): resolve compilation issues from bugfix batch"
```
