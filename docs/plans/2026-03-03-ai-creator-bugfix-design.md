# AI Creator 模块 Bug 修复设计

**日期**: 2026-03-03
**状态**: 已批准
**范围**: P0-P3 全部 10 个问题

## 问题清单

| ID | 严重度 | 问题 | 文件 |
|----|--------|------|------|
| P0-1 | CRITICAL | 选区范围在流式期间过期，导致内容插入到错误位置 | ai-creator-input.tsx |
| P0-2 | CRITICAL | 流式错误/中断后空 assistant 消息残留在历史中 | ai-creator-input.tsx |
| P1-1 | HIGH | 代码复制按钮事件委托无对应 DOM 元素 | ai-creator-message-item.tsx |
| P1-2 | HIGH | 对话历史中丢失选区上下文，多轮修改无连续性 | ai-creator-input.tsx |
| P1-3 | HIGH | handleStop 不清理部分/空消息 | ai-creator-input.tsx |
| P1-4 | HIGH | SSE onComplete 双重调用风险 | ai-service.ts |
| P2-1 | MEDIUM | 历史消息无 content 长度限制（成本攻击） | ai.controller.ts |
| P2-2 | MEDIUM | DOMPurify 允许 img src 无协议限制 | ai-creator-message-item.tsx |
| P3-1 | LOW | extractTitle 函数重复定义 | ai-creator-input.tsx, ai-creator-message-item.tsx |
| P3-2 | LOW | Jotai nullable atom 类型断言 hack 重复 3+ 次 | ai-creator-input.tsx |

## 涉及文件（7 个）

| 文件 | 操作 |
|------|------|
| `ai-creator-utils.ts` | **新建** — 共享工具函数 |
| `ai-creator-atoms.ts` | 修改 — 新增 nullable atom helper |
| `ai-creator.types.ts` | 修改 — 新增 SelectionSnapshot 类型 |
| `ai-creator-input.tsx` | 修改 — P0-1, P0-2, P1-2, P1-3, P3-1, P3-2 |
| `ai-creator-message-item.tsx` | 修改 — P1-1, P2-2, P3-1 |
| `ai-service.ts` | 修改 — P1-4 |
| `ai.controller.ts` | 修改 — P2-1 |

## 修复方案

### P0-1: 选区快照重验证

**策略**: 发送时保存选区文本快照，插入前验证位置是否仍匹配。

1. 在 `ai-creator.types.ts` 新增:
   ```typescript
   export interface SelectionSnapshot {
     text: string;
     from: number;
     to: number;
   }
   ```

2. 在 `handleSubmit` 中，发送前保存快照:
   ```typescript
   const snapshot: SelectionSnapshot | null = selectionRange
     ? { text: editor.state.doc.textBetween(selectionRange.from, selectionRange.to), ...selectionRange }
     : null;
   ```

3. 在自动插入和手动替换逻辑中，插入前验证:
   ```typescript
   function isSelectionStillValid(editor, snapshot): boolean {
     if (!snapshot) return false;
     const docSize = editor.state.doc.content.size;
     if (snapshot.to > docSize) return false;
     const current = editor.state.doc.textBetween(snapshot.from, snapshot.to);
     return current === snapshot.text;
   }
   ```

4. 不匹配时回退到 append 模式并通知用户。

### P0-2 + P1-3: 错误/中断时清理空消息

新增共享函数 `removeLastEmptyAssistant`:
```typescript
const removeLastEmptyAssistant = useCallback(() => {
  setAllMessages((prev) => {
    const msgs = [...(prev[pageId] || [])];
    if (msgs.length && msgs[msgs.length - 1].role === 'assistant'
        && !msgs[msgs.length - 1].content.trim()) {
      msgs.pop();
    }
    return { ...prev, [pageId]: msgs };
  });
}, [pageId, setAllMessages]);
```

调用位置:
- `onError` 回调
- `handleStop` 函数
- `catch` 块

### P1-1: 代码复制按钮

在 `bubbleMarked` 的 code renderer 返回值中追加按钮:
```html
<pre class="code-block-wrapper" data-language="...">
  <button class="code-copy-btn" title="Copy">
    <svg>...</svg>
  </button>
  <code class="hljs ...">...</code>
</pre>
```

CSS 添加到 `ai-creator.module.css`:
```css
.code-copy-btn { position: absolute; top: 8px; right: 8px; ... }
.code-block-wrapper { position: relative; }
```

注意: DOMPurify ALLOWED_TAGS 需添加 `button`, `svg`, `path`；ALLOWED_ATTR 需添加 `viewBox`, `d`, `fill`, `stroke` 等 SVG 属性。

### P1-2: 历史消息保留选区上下文

构建 history 时检查原始消息的 `selectionContext`:
```typescript
content: m.selectionContext
  ? `[修改选区内容]\n${m.selectionContext.slice(0, 200)}\n\n${m.content}`
  : m.content,
```

### P1-4: onComplete 幂等保护

在 `generateAiContentStream` 和 `creatorGenerate` 中:
```typescript
let completed = false;
// [DONE] 路径
if (!completed) { completed = true; onComplete?.(); }
// reader done 路径
if (!completed) { completed = true; onComplete?.(); }
```

### P2-1: 历史消息长度限制

后端 controller 中:
```typescript
history = parsed
  .filter((m: any) => m.role && m.content)
  .map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 10000) : '',
  }))
  .slice(-10);
```

### P2-2: DOMPurify URI 限制

```typescript
const PURIFY_CONFIG = {
  // ... existing config
  ALLOWED_URI_REGEXP: /^(?:https?|data):/i,
};
```

### P3-1: 提取共享工具函数

新建 `ai-creator-utils.ts`:
```typescript
export function extractTitle(markdown: string): [string | null, string] { ... }
export function stripTimestamp(content: string): string { ... }
```

两个文件改为 `import { extractTitle, stripTimestamp } from './ai-creator-utils'`。

### P3-2: Jotai nullable atom helper

在 `ai-creator-atoms.ts` 中:
```typescript
import { useAtom, WritableAtom } from 'jotai';

export function useNullableAtom<T>(atom: WritableAtom<T | null, [T | null], void>) {
  const [value, setValue] = useAtom(atom);
  return [value, setValue] as const;
}
```

替换所有 `const [x, _setX] = useAtom(...); const setX = _setX as ...` 模式。
