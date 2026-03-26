# Phase 2: Intelligent Agent Frontend 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 MiniMax 式对话面板（AgentPanel）取代当前多阶段 AiCreatorPanel，调用 Phase 1 的 `POST /api/agent/v2/run` 端点，实现"对话 + 工具可见 + 流式预览 + 一键应用"体验。

**Architecture:** 右侧 Aside 面板内渲染 AgentPanel 组件树。LLM 流式输出在面板中用 `marked` + `DOMPurify` 渲染为 HTML 预览（不触碰 TipTap 编辑器）。用户点击"应用到页面"后，完整 Markdown 通过服务端 Y.js commit 一次性写入编辑器。

**Tech Stack:** React 18, TypeScript 5.7, Mantine 8, Jotai, @tabler/icons-react, marked, DOMPurify, CSS Modules

**Spec:** `docs/superpowers/specs/2026-03-26-intelligent-agent-redesign.md` 第 3.2 节（SSE 事件）+ 第 5 节（前端设计）

**Worktree:** `E:/test/Docmost/.worktrees/feat-intelligent-agent`（分支 `feat/intelligent-agent`）

**关键设计决策（已调研确认）：**

1. **不在编辑器中实时流式写入** — TipTap + Y.js 环境下存在不完整 Markdown 解析、undo 污染、Transaction 级联、Y.js 过载等致命问题。业界（Notion AI / Novel.sh / Cursor）均采用"预览 → 确认 → 应用"模式。
2. **v2 端点使用 JSON body（含 base64 文件）** — 不同于 v1 的 FormData，v2 需要前端将 File 转为 base64 字符串。
3. **SSE 事件集简化** — v2 只有 9 种事件（session/tool_call/tool_result/thinking/content/warning/done/error/cancelled），远简于 v1 的 15+ 种。

---

## 文件结构

### 新建文件

```
apps/client/src/ee/ai/
├── types/
│   └── agent-v2.types.ts              # V2 SSE 事件类型 + 面板状态类型
├── services/
│   └── agent-v2-service.ts            # V2 SSE 通信服务（fetch + ReadableStream）
├── hooks/
│   └── use-agent-session.ts           # V2 会话管理 Hook（状态机 + 事件处理）
└── components/agent-panel/
    ├── agent-panel.tsx                 # 主容器（管理对话状态）
    ├── agent-panel.module.css          # 全部样式（CSS Modules）
    ├── agent-panel-atoms.ts            # Jotai 原子（文件、会话）
    ├── message-list.tsx                # 消息列表（用户 + Agent）
    ├── user-message.tsx                # 用户消息气泡（文本 + 文件缩略图）
    ├── agent-message.tsx               # Agent 回复容器（工具步骤 + 流式内容）
    ├── tool-call-step.tsx              # 工具调用状态行（🔄 → ✅）
    ├── streaming-markdown.tsx          # Markdown 流式 HTML 预览
    ├── action-bar.tsx                  # 应用 / 重新生成 / 复制 按钮
    └── input-bar.tsx                   # 文件上传 + 文本输入 + 发送
```

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/client/src/components/layouts/global/aside.tsx` | 导入 AgentPanel，添加 `"agent"` tab 分支 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts` | 保留不变（v1 仍可用），v2 用独立 atoms |

### 复用文件（不修改）

| 文件 | 复用内容 |
|------|---------|
| `packages/editor-ext/src/lib/markdown/utils/marked.utils.ts` | `markdownToHtml()` 函数 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.ts` | `insertMarkdownAtDocumentEnd()`、`appendMarkdownToEditor()` |
| `apps/client/src/ee/ai/hooks/ai-create-session.commit.ts` | `commitDraftWithRecovery()` 服务端 Y.js 提交 |
| `apps/client/src/features/editor/atoms/editor-atoms.ts` | `pageEditorAtom`、`titleEditorAtom` |
| `apps/client/src/components/layouts/global/hooks/atoms/sidebar-atom.ts` | `asideStateAtom` |
| `apps/client/src/lib/api-client.ts` | Axios 实例（用于非流式请求） |

---

## Task 1: V2 类型定义

**Files:**
- Create: `apps/client/src/ee/ai/types/agent-v2.types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// apps/client/src/ee/ai/types/agent-v2.types.ts

/** V2 SSE 事件类型 — 对应 agent-service event_bridge.py 的输出 */
export type AgentV2Event =
  | { type: "session"; thread_id: string }
  | { type: "tool_call"; tool: string; description: string; args?: Record<string, unknown> }
  | { type: "tool_result"; status: string }
  | { type: "thinking"; content: string }
  | { type: "content"; chunk: string }
  | { type: "warning"; issues: string[] }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

/** 工具调用步骤（前端展示用） */
export interface ToolStep {
  id: string;
  tool: string;
  description: string;
  status: "running" | "done";
}

/** 面板消息 */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** 用户消息附带的文件名列表 */
  files?: string[];
  /** Agent 消息附带的工具调用步骤 */
  toolSteps?: ToolStep[];
  /** Agent 消息是否仍在流式输出 */
  streaming?: boolean;
  /** 后验证警告 */
  warnings?: string[];
}

/** 会话状态 */
export type AgentSessionStatus =
  | "idle"
  | "streaming"
  | "thinking"
  | "done"
  | "error"
  | "cancelled";

/** useAgentSession Hook 的返回类型 */
export interface AgentSessionAPI {
  messages: AgentMessage[];
  status: AgentSessionStatus;
  threadId: string | null;
  /** 最后一次 Agent 完成输出的 Markdown（用于"应用到页面"） */
  lastOutput: string | null;
  submit: (prompt: string, files?: File[]) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/** 发送给 v2 端点的请求体（camelCase — NestJS Gateway 负责转为 snake_case） */
export interface AgentV2RunRequest {
  prompt: string;
  pageId?: string;
  threadId?: string;
  /** workspace_id 和 user_id 由 NestJS Gateway 从 JWT 自动注入，前端不传 */
  files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
}
```

- [ ] **Step 2: 确认 TypeScript 编译通过**

```bash
cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: 无与新文件相关的报错

- [ ] **Step 3: 提交**

```bash
git add apps/client/src/ee/ai/types/agent-v2.types.ts
git commit -m "feat(agent-panel): add V2 SSE event types and panel state types"
```

---

## Task 2: V2 SSE 通信服务

**Files:**
- Create: `apps/client/src/ee/ai/services/agent-v2-service.ts`

**依赖知识：**
- 现有 `agent-service.ts` 的 SSE 模式：`fetch` + `ReadableStream` + `TextDecoder` + 手动 SSE 行解析
- v2 端点 `POST /api/agent/v2/run` 接受 JSON body（非 FormData），文件为 base64
- v2 端点返回 SSE 流，每行格式 `data: {"type":"...","chunk":"..."}`

- [ ] **Step 1: 实现 File → base64 转换工具**

```typescript
// apps/client/src/ee/ai/services/agent-v2-service.ts

import type { AgentV2Event, AgentV2RunRequest } from "../types/agent-v2.types";

/** 将 File 对象转为 base64 字符串 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:mime;base64,XXXX → 取逗号后面的部分
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 2: 实现 SSE 行解析函数**

```typescript
/** 解析一行 SSE 数据，返回事件对象或 null */
function parseSseLine(line: string): AgentV2Event | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data: ")) return null;
  const json = trimmed.slice(6); // 去掉 "data: "
  if (json === "[DONE]") return null;
  try {
    return JSON.parse(json) as AgentV2Event;
  } catch {
    return null;
  }
}

/** 消费 SSE buffer，返回剩余未完成的部分 */
function consumeBuffer(
  buffer: string,
  onEvent: (event: AgentV2Event) => void,
): string {
  const lines = buffer.split("\n");
  // 最后一行可能不完整，保留
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    const event = parseSseLine(line);
    if (event) onEvent(event);
  }
  return remainder;
}
```

- [ ] **Step 3: 实现主函数 `agentV2Run`**

```typescript
/** 发送 Agent V2 请求并流式接收 SSE 事件 */
export function agentV2Run(
  params: {
    prompt: string;
    pageId?: string;
    threadId?: string;
    files?: File[];
  },
  onEvent: (event: AgentV2Event) => void,
  onError: (error: string) => void,
  onComplete: () => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      // 1. 文件转 base64
      const filePayloads = await Promise.all(
        (params.files ?? []).map(async (f) => ({
          content_b64: await fileToBase64(f),
          filename: f.name,
          mimetype: f.type || "application/octet-stream",
        })),
      );

      // 2. 发送 JSON 请求
      const body: AgentV2RunRequest = {
        prompt: params.prompt,
        pageId: params.pageId,
        threadId: params.threadId,
        files: filePayloads.length > 0 ? filePayloads : undefined,
      };

      const response = await fetch("/api/agent/v2/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: "include",
      });

      if (!response.ok) {
        const text = await response.text();
        onError(`Agent service error: ${response.status} ${text}`);
        return;
      }

      // 3. 流式读取 SSE
      const reader = response.body?.getReader();
      if (!reader) {
        onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeBuffer(buffer, onEvent);
      }

      // 处理 buffer 中剩余内容
      if (buffer.trim()) {
        const event = parseSseLine(buffer);
        if (event) onEvent(event);
      }

      reader.releaseLock();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      onComplete();
    }
  })();

  return controller;
}
```

- [ ] **Step 4: 确认编译通过**

```bash
cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 5: 提交**

```bash
git add apps/client/src/ee/ai/services/agent-v2-service.ts
git commit -m "feat(agent-panel): add V2 SSE streaming service with base64 file support"
```

---

## Task 3: Jotai 状态原子

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/agent-panel-atoms.ts`

- [ ] **Step 1: 创建原子文件**

```typescript
// apps/client/src/ee/ai/components/agent-panel/agent-panel-atoms.ts
import { atom } from "jotai";

/** Agent 面板上传的文件列表 */
export const agentFilesAtom = atom<File[]>([]);

/** 当前对话的 thread_id（由 session SSE 事件设置） */
export const agentThreadIdAtom = atom<string | null>(null);
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/agent-panel-atoms.ts
git commit -m "feat(agent-panel): add Jotai atoms for agent panel state"
```

---

## Task 4: 会话管理 Hook

**Files:**
- Create: `apps/client/src/ee/ai/hooks/use-agent-session.ts`

**核心职责：**
- 管理消息列表（`AgentMessage[]`）
- 处理 SSE 事件流 → 更新消息状态
- 提供 `submit` / `cancel` / `reset` API
- 累积流式 content → 最终 `lastOutput`

- [ ] **Step 1: 实现 Hook 基本结构**

```typescript
// apps/client/src/ee/ai/hooks/use-agent-session.ts
import { useCallback, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { agentV2Run } from "../services/agent-v2-service";
import type {
  AgentMessage,
  AgentSessionAPI,
  AgentSessionStatus,
  AgentV2Event,
  ToolStep,
} from "../types/agent-v2.types";

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

export function useAgentSession(pageId: string): AgentSessionAPI {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<AgentSessionStatus>("idle");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef("");
  const toolStepsRef = useRef<ToolStep[]>([]);
  const assistantIdRef = useRef("");

  const editor = useAtomValue(pageEditorAtom);

  /** 更新最后一条 assistant 消息的内容 */
  const updateLastAssistant = useCallback(
    (updater: (prev: AgentMessage) => Partial<AgentMessage>) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === assistantIdRef.current);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], ...updater(prev[idx]) };
        return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
      });
    },
    [],
  );

  /** 处理单个 SSE 事件 */
  const handleEvent = useCallback(
    (event: AgentV2Event) => {
      switch (event.type) {
        case "session":
          setThreadId(event.thread_id);
          break;

        case "thinking":
          setStatus("thinking");
          break;

        case "tool_call": {
          const step: ToolStep = {
            id: `tool-${Date.now()}`,
            tool: event.tool,
            description: event.description,
            status: "running",
          };
          toolStepsRef.current = [...toolStepsRef.current, step];
          updateLastAssistant(() => ({
            toolSteps: [...toolStepsRef.current],
          }));
          break;
        }

        case "tool_result":
          toolStepsRef.current = toolStepsRef.current.map((s) =>
            s.status === "running" ? { ...s, status: "done" as const } : s,
          );
          updateLastAssistant(() => ({
            toolSteps: [...toolStepsRef.current],
          }));
          break;

        case "content":
          setStatus("streaming");
          contentRef.current += event.chunk;
          updateLastAssistant(() => ({
            content: contentRef.current,
            streaming: true,
          }));
          break;

        case "warning":
          updateLastAssistant(() => ({
            warnings: event.issues,
          }));
          break;

        case "done":
          setStatus("done");
          setLastOutput(contentRef.current);
          updateLastAssistant(() => ({ streaming: false }));
          break;

        case "error":
          setStatus("error");
          updateLastAssistant(() => ({
            content: contentRef.current || `Error: ${event.message}`,
            streaming: false,
          }));
          break;

        case "cancelled":
          setStatus("cancelled");
          updateLastAssistant(() => ({ streaming: false }));
          break;
      }
    },
    [updateLastAssistant],
  );

  /** 提交用户消息 */
  const submit = useCallback(
    async (prompt: string, files?: File[]) => {
      // 添加用户消息
      const userMsg: AgentMessage = {
        id: nextId(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
        files: files?.map((f) => f.name),
      };

      // 创建空的 assistant 消息占位
      const assistantMsg: AgentMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        toolSteps: [],
        streaming: true,
      };
      assistantIdRef.current = assistantMsg.id;

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus("streaming");
      setLastOutput(null);
      contentRef.current = "";
      toolStepsRef.current = [];

      // 锁定编辑器
      if (editor) {
        editor.setEditable(false);
        editor.view.dom.classList.add("ai-generating");
      }

      // 发起 SSE 请求
      abortRef.current = agentV2Run(
        { prompt, pageId, threadId: threadId ?? undefined, files },
        handleEvent,
        (error) => {
          setStatus("error");
          updateLastAssistant(() => ({
            content: `Error: ${error}`,
            streaming: false,
          }));
        },
        () => {
          // 解锁编辑器
          if (editor) {
            editor.setEditable(true);
            editor.view.dom.classList.remove("ai-generating");
          }
        },
      );
    },
    [pageId, threadId, editor, handleEvent, updateLastAssistant],
  );

  /** 取消当前请求 */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("cancelled");
    updateLastAssistant(() => ({ streaming: false }));
    if (editor) {
      editor.setEditable(true);
      editor.view.dom.classList.remove("ai-generating");
    }
  }, [editor, updateLastAssistant]);

  /** 重置对话 */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStatus("idle");
    setThreadId(null);
    setLastOutput(null);
    contentRef.current = "";
    toolStepsRef.current = [];
    assistantIdRef.current = "";
  }, []);

  return { messages, status, threadId, lastOutput, submit, cancel, reset };
}
```

- [ ] **Step 2: 确认编译通过**

```bash
cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add apps/client/src/ee/ai/hooks/use-agent-session.ts
git commit -m "feat(agent-panel): add useAgentSession hook with SSE event handling"
```

---

## Task 5: StreamingMarkdown 组件

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/streaming-markdown.tsx`

**职责：** 将 Agent 累积输出的 Markdown 渲染为 HTML 预览（marked + DOMPurify），不触碰 TipTap 编辑器。

- [ ] **Step 1: 实现组件**

```tsx
// apps/client/src/ee/ai/components/agent-panel/streaming-markdown.tsx
import { useEffect, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import classes from "./agent-panel.module.css";

const previewMarked = new Marked({ breaks: true });

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "div", "span", "details", "summary",
    "input", // for task lists
  ],
  ALLOWED_ATTR: [
    "href", "src", "alt", "title", "class", "target", "rel",
    "type", "checked", "disabled",
  ],
};

/** 节流渲染：流式期间 ~15fps（67ms），完成后立即渲染最终版本 */
function useThrottledValue(value: string, streaming?: boolean): string {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!streaming) {
      cancelAnimationFrame(rafRef.current);
      setThrottled(value);
      return;
    }
    const now = Date.now();
    if (now - lastUpdate.current > 67) {
      lastUpdate.current = now;
      setThrottled(value);
    } else {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        lastUpdate.current = Date.now();
        setThrottled(value);
      });
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, streaming]);

  return throttled;
}

interface StreamingMarkdownProps {
  content: string;
  streaming?: boolean;
}

export function StreamingMarkdown({ content, streaming }: StreamingMarkdownProps) {
  const displayContent = useThrottledValue(content, streaming);

  const html = (() => {
    if (!displayContent) return "";
    const raw = previewMarked.parse(displayContent) as string;
    return DOMPurify.sanitize(raw, PURIFY_CONFIG);
  })();

  return (
    <div className={classes.markdownPreview}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming && <span className={classes.streamingCursor} />}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/streaming-markdown.tsx
git commit -m "feat(agent-panel): add StreamingMarkdown preview component"
```

---

## Task 6: ToolCallStep 组件

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/tool-call-step.tsx`

- [ ] **Step 1: 实现组件**

```tsx
// apps/client/src/ee/ai/components/agent-panel/tool-call-step.tsx
import { Group, Loader, Text, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { ToolStep } from "../../types/agent-v2.types";
import classes from "./agent-panel.module.css";

interface ToolCallStepProps {
  step: ToolStep;
}

export function ToolCallStep({ step }: ToolCallStepProps) {
  return (
    <Group gap={8} className={classes.toolStep}>
      {step.status === "running" ? (
        <Loader size={14} />
      ) : (
        <ThemeIcon size={18} radius="xl" color="teal" variant="light">
          <IconCheck size={12} />
        </ThemeIcon>
      )}
      <Text size="xs" c="dimmed">
        {step.description}
      </Text>
    </Group>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/tool-call-step.tsx
git commit -m "feat(agent-panel): add ToolCallStep status indicator component"
```

---

## Task 7: UserMessage + AgentMessage 组件

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/user-message.tsx`
- Create: `apps/client/src/ee/ai/components/agent-panel/agent-message.tsx`

- [ ] **Step 1: 实现 UserMessage**

```tsx
// apps/client/src/ee/ai/components/agent-panel/user-message.tsx
import { Badge, Group, Stack, Text } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import type { AgentMessage } from "../../types/agent-v2.types";
import classes from "./agent-panel.module.css";

interface UserMessageProps {
  message: AgentMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className={classes.userMessage}>
      <Group gap={8} mb={4}>
        <IconUser size={16} />
        <Text size="sm" fw={500}>You</Text>
      </Group>
      <Text size="sm">{message.content}</Text>
      {message.files && message.files.length > 0 && (
        <Group gap={4} mt={4}>
          {message.files.map((name) => (
            <Badge key={name} size="xs" variant="light">
              {name}
            </Badge>
          ))}
        </Group>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 实现 AgentMessage**

```tsx
// apps/client/src/ee/ai/components/agent-panel/agent-message.tsx
import { Alert, Stack, Text } from "@mantine/core";
import { IconSparkles, IconAlertTriangle } from "@tabler/icons-react";
import type { AgentMessage as AgentMessageType } from "../../types/agent-v2.types";
import { ToolCallStep } from "./tool-call-step";
import { StreamingMarkdown } from "./streaming-markdown";
import classes from "./agent-panel.module.css";

interface AgentMessageProps {
  message: AgentMessageType;
}

export function AgentMessage({ message }: AgentMessageProps) {
  return (
    <div className={classes.agentMessage}>
      <Stack gap={4}>
        {/* 工具调用步骤 */}
        {message.toolSteps?.map((step) => (
          <ToolCallStep key={step.id} step={step} />
        ))}

        {/* Markdown 流式预览 */}
        {message.content && (
          <StreamingMarkdown
            content={message.content}
            streaming={message.streaming}
          />
        )}

        {/* 后验证警告 */}
        {message.warnings && message.warnings.length > 0 && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            variant="light"
            p="xs"
          >
            {message.warnings.map((w, i) => (
              <Text key={i} size="xs">{w}</Text>
            ))}
          </Alert>
        )}
      </Stack>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/user-message.tsx apps/client/src/ee/ai/components/agent-panel/agent-message.tsx
git commit -m "feat(agent-panel): add UserMessage and AgentMessage components"
```

---

## Task 8: ActionBar 组件

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/action-bar.tsx`

**职责：** 在 Agent 输出完成后显示"应用到页面 / 重新生成 / 复制"按钮。

- [ ] **Step 1: 实现组件**

```tsx
// apps/client/src/ee/ai/components/agent-panel/action-bar.tsx
import { Button, Group } from "@mantine/core";
import { IconArrowBarDown, IconCopy, IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import classes from "./agent-panel.module.css";

interface ActionBarProps {
  onApply: () => void;
  onRegenerate: () => void;
  content: string;
  disabled?: boolean;
}

export function ActionBar({ onApply, onRegenerate, content, disabled }: ActionBarProps) {
  const { t } = useTranslation();

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    notifications.show({ message: t("Copied"), color: "green" });
  };

  return (
    <Group gap="xs" className={classes.actionBar}>
      <Button
        size="xs"
        leftSection={<IconArrowBarDown size={14} />}
        onClick={onApply}
        disabled={disabled}
      >
        {t("Apply to page")}
      </Button>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconRefresh size={14} />}
        onClick={onRegenerate}
        disabled={disabled}
      >
        {t("Regenerate")}
      </Button>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconCopy size={14} />}
        onClick={handleCopy}
      >
        {t("Copy")}
      </Button>
    </Group>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/action-bar.tsx
git commit -m "feat(agent-panel): add ActionBar with apply/regenerate/copy buttons"
```

---

## Task 9: InputBar 组件

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/input-bar.tsx`

**职责：** 文件上传 + 文本输入 + 发送 / 停止按钮。复用现有文件上传模式（hidden input + FileReader）。

- [ ] **Step 1: 实现组件**

```tsx
// apps/client/src/ee/ai/components/agent-panel/input-bar.tsx
import { useRef, useState, useCallback, type KeyboardEvent } from "react";
import { ActionIcon, Badge, Group, Stack, Textarea, Tooltip } from "@mantine/core";
import {
  IconArrowUp,
  IconPaperclip,
  IconPlayerStop,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import classes from "./agent-panel.module.css";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED = ".pdf,.doc,.docx,.ppt,.pptx,.html,.png,.jpg,.jpeg";

interface InputBarProps {
  onSubmit: (prompt: string, files?: File[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
}

export function InputBar({ onSubmit, onCancel, isStreaming }: InputBarProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newFiles = Array.from(e.target.files ?? []);
      const valid = newFiles.filter((f) => {
        if (f.size > MAX_FILE_SIZE) {
          notifications.show({ message: `${f.name} exceeds 20MB`, color: "red" });
          return false;
        }
        return true;
      });
      setFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const prompt = text.trim();
    if (!prompt && files.length === 0) return;
    onSubmit(prompt, files.length > 0 ? files : undefined);
    setText("");
    setFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) handleSubmit();
    }
  };

  return (
    <div className={classes.inputBar}>
      {files.length > 0 && (
        <Group gap={4} mb={4}>
          {files.map((f, i) => (
            <Badge
              key={`${f.name}-${i}`}
              size="sm"
              variant="light"
              rightSection={
                <IconX
                  size={12}
                  style={{ cursor: "pointer" }}
                  onClick={() => removeFile(i)}
                />
              }
            >
              {f.name}
            </Badge>
          ))}
        </Group>
      )}
      <Group gap={4} align="flex-end">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <Tooltip label={t("Attach files")}>
          <ActionIcon
            variant="subtle"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
          >
            <IconPaperclip size={18} />
          </ActionIcon>
        </Tooltip>
        <Textarea
          className={classes.inputTextarea}
          placeholder={t("Describe what to create...")}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={6}
          disabled={isStreaming}
          style={{ flex: 1 }}
        />
        {isStreaming ? (
          <Tooltip label={t("Stop")}>
            <ActionIcon variant="filled" color="red" onClick={onCancel}>
              <IconPlayerStop size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label={t("Send")}>
            <ActionIcon
              variant="filled"
              onClick={handleSubmit}
              disabled={!text.trim() && files.length === 0}
            >
              <IconArrowUp size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/input-bar.tsx
git commit -m "feat(agent-panel): add InputBar with file upload and keyboard submit"
```

---

## Task 10: MessageList 组件

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/message-list.tsx`

- [ ] **Step 1: 实现组件**

```tsx
// apps/client/src/ee/ai/components/agent-panel/message-list.tsx
import { useEffect, useRef } from "react";
import { ScrollArea, Stack, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { AgentMessage as AgentMessageType } from "../../types/agent-v2.types";
import { UserMessage } from "./user-message";
import { AgentMessage } from "./agent-message";
import classes from "./agent-panel.module.css";

interface MessageListProps {
  messages: AgentMessageType[];
}

export function MessageList({ messages }: MessageListProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className={classes.emptyState}>
        <IconSparkles size={32} opacity={0.3} />
        <Text size="sm" c="dimmed" ta="center" mt="sm">
          {t("Describe what you want to create, or upload a document to get started.")}
        </Text>
      </div>
    );
  }

  return (
    <ScrollArea className={classes.messageList} offsetScrollbars>
      <Stack gap="md" p="sm">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AgentMessage key={msg.id} message={msg} />
          ),
        )}
        <div ref={bottomRef} />
      </Stack>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/message-list.tsx
git commit -m "feat(agent-panel): add MessageList with auto-scroll and empty state"
```

---

## Task 11: AgentPanel 主容器 + 应用逻辑

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx`

**职责：** 组合所有子组件 + 实现"应用到页面"逻辑（调用服务端 Y.js commit）。

- [ ] **Step 1: 实现主容器**

```tsx
// apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx
import { useCallback } from "react";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { IconPlus, IconSparkles, IconX } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";

import { useParams } from "react-router-dom";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import { extractPageSlugId } from "@/lib";
import { usePageQuery } from "@/features/page/queries/page-query";
import {
  insertMarkdownAtDocumentEnd,
  maybeExtractTitle,
} from "../ai-creator/ai-creator-writeback";
import {
  captureAiCreatePageSnapshot,
  commitDraftWithRecovery,
} from "../../hooks/ai-create-session.commit";
import { creatorCommit } from "../../services/ai-service";
import api from "@/lib/api-client";

import { useAgentSession } from "../../hooks/use-agent-session";
import { MessageList } from "./message-list";
import { ActionBar } from "./action-bar";
import { InputBar } from "./input-bar";
import classes from "./agent-panel.module.css";

export default function AgentPanel() {
  const { t } = useTranslation();
  const [aside, setAside] = useAtom(asideStateAtom);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const { data: page } = usePageQuery({ pageId });

  const session = useAgentSession(pageId);

  const closePanel = () => setAside({ tab: "", isAsideOpen: false });

  /** 应用到页面 — 服务端 Y.js commit */
  const handleApply = useCallback(async () => {
    if (!session.lastOutput || !editor || !pageId) return;

    try {
      // 提取标题（如有 H1）
      const markdown = titleEditor
        ? maybeExtractTitle(titleEditor, session.lastOutput)
        : session.lastOutput;

      // 通过服务端 Y.js 一次性写入
      const snapshot = captureAiCreatePageSnapshot(editor, titleEditor);
      const result = await commitDraftWithRecovery({
        pageId,
        content: markdown,
        insertMode: "overwrite",
        expectedUpdatedAt: page?.updatedAt ?? null,
        pageSnapshot: snapshot,
        editor,
        titleEditor,
        commit: creatorCommit,
        fetchLatestPage: async (id) => {
          const res = await api.post("/pages/info", { pageId: id });
          return res.data;
        },
      });

      if (result.ok) {
        notifications.show({ message: t("Applied to page"), color: "green" });
      } else {
        notifications.show({
          message: t("Failed to apply: ") + result.reason,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({ message: t("Failed to apply"), color: "red" });
    }
  }, [session.lastOutput, editor, titleEditor, pageId, page?.updatedAt, t]);

  /** 重新生成 — 用最后一条用户消息重新提交（仅文本，文件不保留） */
  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...session.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMsg) {
      session.submit(lastUserMsg.content);
    }
  }, [session.messages, session.submit]);

  const isDone = session.status === "done";
  const isStreaming =
    session.status === "streaming" || session.status === "thinking";

  return (
    <div className={classes.panelRoot}>
      {/* Header */}
      <Group className={classes.panelHeader} justify="space-between" px="sm" py={6}>
        <Group gap={6}>
          <IconSparkles size={18} />
          <Text size="sm" fw={600}>
            {t("AI Agent")}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label={t("New conversation")}>
            <ActionIcon variant="subtle" size="sm" onClick={session.reset}>
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Close")}>
            <ActionIcon variant="subtle" size="sm" onClick={closePanel}>
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Messages */}
      <MessageList messages={session.messages} />

      {/* Action Bar (done 时显示) */}
      {isDone && session.lastOutput && (
        <ActionBar
          onApply={handleApply}
          onRegenerate={handleRegenerate}
          content={session.lastOutput}
        />
      )}

      {/* Input Bar */}
      <InputBar
        onSubmit={session.submit}
        onCancel={session.cancel}
        isStreaming={isStreaming}
      />
    </div>
  );
}
```

- [ ] **Step 2: 确认编译通过**

```bash
cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 3: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx
git commit -m "feat(agent-panel): add AgentPanel main container with apply-to-page logic"
```

---

## Task 12: CSS 样式

**Files:**
- Create: `apps/client/src/ee/ai/components/agent-panel/agent-panel.module.css`

- [ ] **Step 1: 创建样式文件**

```css
/* apps/client/src/ee/ai/components/agent-panel/agent-panel.module.css */

.panelRoot {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panelHeader {
  border-bottom: 1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5));
  flex-shrink: 0;
}

.messageList {
  flex: 1;
  overflow: hidden; /* ScrollArea 组件自行管理滚动 */
}

.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--mantine-spacing-xl);
}

/* 用户消息 */
.userMessage {
  padding: var(--mantine-spacing-sm);
  background: light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6));
  border-radius: var(--mantine-radius-md);
}

/* Agent 消息 */
.agentMessage {
  padding: var(--mantine-spacing-sm) 0;
}

/* 工具调用步骤 */
.toolStep {
  padding: 2px 0;
}

/* Markdown 预览 */
.markdownPreview {
  font-size: var(--mantine-font-size-sm);
  line-height: 1.6;
}

.markdownPreview h1,
.markdownPreview h2,
.markdownPreview h3 {
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdownPreview h1 { font-size: 1.4em; }
.markdownPreview h2 { font-size: 1.2em; }
.markdownPreview h3 { font-size: 1.1em; }

.markdownPreview p {
  margin: 0.5em 0;
}

.markdownPreview pre {
  background: light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7));
  padding: var(--mantine-spacing-xs);
  border-radius: var(--mantine-radius-sm);
  overflow-x: auto;
  font-size: 0.85em;
}

.markdownPreview code {
  font-size: 0.9em;
  padding: 1px 4px;
  background: light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7));
  border-radius: 3px;
}

.markdownPreview pre code {
  padding: 0;
  background: none;
}

.markdownPreview table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
  font-size: 0.9em;
}

.markdownPreview th,
.markdownPreview td {
  border: 1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4));
  padding: 4px 8px;
  text-align: left;
}

.markdownPreview th {
  background: light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6));
  font-weight: 600;
}

.markdownPreview img {
  max-width: 100%;
  border-radius: var(--mantine-radius-sm);
  margin: 0.5em 0;
}

.markdownPreview blockquote {
  border-left: 3px solid light-dark(var(--mantine-color-gray-4), var(--mantine-color-dark-4));
  padding-left: var(--mantine-spacing-sm);
  margin: 0.5em 0;
  color: light-dark(var(--mantine-color-gray-7), var(--mantine-color-dark-2));
}

/* 流式输出光标 */
.streamingCursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: light-dark(var(--mantine-color-dark-9), var(--mantine-color-gray-0));
  margin-left: 2px;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 操作栏 */
.actionBar {
  padding: var(--mantine-spacing-xs) var(--mantine-spacing-sm);
  border-top: 1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5));
  flex-shrink: 0;
}

/* 输入栏 */
.inputBar {
  padding: var(--mantine-spacing-xs) var(--mantine-spacing-sm);
  border-top: 1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5));
  flex-shrink: 0;
}

.inputTextarea textarea {
  font-size: var(--mantine-font-size-sm);
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/client/src/ee/ai/components/agent-panel/agent-panel.module.css
git commit -m "feat(agent-panel): add CSS module styles for agent panel"
```

---

## Task 13: 接入 Aside 面板

**Files:**
- Modify: `apps/client/src/components/layouts/global/aside.tsx`

- [ ] **Step 1: 读取当前 aside.tsx 的完整内容**

```bash
cat apps/client/src/components/layouts/global/aside.tsx
```

- [ ] **Step 2: 添加 AgentPanel 导入和 tab 分支**

在 `aside.tsx` 文件顶部添加导入：

```typescript
import AgentPanel from "@/ee/ai/components/agent-panel/agent-panel";
```

在 `ai-creator` tab 分支之前（或之后），添加 `agent` tab 的早期返回：

```typescript
if (tab === "agent") {
  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AgentPanel />
    </Box>
  );
}
```

- [ ] **Step 3: 添加一个临时入口按钮（用于测试）**

在编辑器页面某处添加一个按钮或快捷键，将 `asideStateAtom` 设为 `{ tab: "agent", isAsideOpen: true }`。

具体位置：查找当前打开 AI Creator 的触发点（通常在编辑器工具栏或快捷键处），添加一个平行入口。

搜索 `"ai-creator"` 在 atom 设置中的使用位置：

```bash
grep -rn '"ai-creator"' apps/client/src/ --include="*.ts" --include="*.tsx" | head -20
```

在最常用的触发点旁添加 v2 入口。

- [ ] **Step 4: 确认编译 + 本地 dev 可见**

```bash
cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 5: 提交**

```bash
git add apps/client/src/components/layouts/global/aside.tsx
git commit -m "feat(agent-panel): wire AgentPanel into aside with 'agent' tab"
```

---

## Task 14: 端到端冒烟验证

**前提：** 需要运行 Docmost 开发环境 + Agent Service。

- [ ] **Step 1: 启动服务**

```bash
# 终端 1: NestJS + Vite
pnpm dev

# 终端 2: Agent Service
cd agent-service && python run.py
```

- [ ] **Step 2: 浏览器验证**

| TC | 操作 | 预期 |
|----|------|------|
| TC-01 | 打开 Agent 面板 | 右侧面板显示 AgentPanel，空状态提示 |
| TC-02 | 输入文本 + 按 Enter | 用户消息出现，Agent 开始流式回复 |
| TC-03 | 观察工具调用 | ToolCallStep 显示 🔄 → ✅ |
| TC-04 | 观察流式输出 | StreamingMarkdown 实时渲染 Markdown + 闪烁光标 |
| TC-05 | 等待完成 | ActionBar 显示"应用到页面"按钮 |
| TC-06 | 点击"应用到页面" | 编辑器内容更新为 Agent 输出 |
| TC-07 | 点击"复制" | 剪贴板包含 Markdown 内容 |
| TC-08 | 流式中点击"停止" | 流式中断，面板重置为可输入状态 |
| TC-09 | 点击"新对话" | 消息列表清空，回到空状态 |
| TC-10 | 上传 PDF + 输入指令 | 文件 badge 显示，Agent 调用 extract_document 工具 |
| TC-11 | 关闭面板再打开 | 面板状态保持 |

- [ ] **Step 3: 修复发现的问题**

根据冒烟测试结果修复 bug。每个 bug 单独 commit。

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "fix(agent-panel): address smoke test issues"
```

---

## 任务依赖图与执行顺序

**关键：Task 12（CSS）必须在所有组件之前创建**，因为 Tasks 5-11 都 import `agent-panel.module.css`。

```
Task 1 (types) ─────────────────┐
Task 3 (atoms) ─────────────────┤ 可并行
  ↓                             │
Task 2 (SSE service) ←── Task 1│
  ↓                             │
Task 12 (CSS) ──────────────────┘ ← 必须在组件之前
  ↓
Task 4 (session hook) ←── Task 1, Task 2
  ↓
Task 5 (StreamingMarkdown) ─┐
Task 6 (ToolCallStep) ──────┤ 可并行（都依赖 Task 12 CSS）
Task 8 (ActionBar) ─────────┤
Task 9 (InputBar) ──────────┘
  ↓
Task 7 (UserMsg + AgentMsg) ←── Task 5, Task 6
  ↓
Task 10 (MessageList) ←──── Task 7
  ↓
Task 11 (AgentPanel) ←───── Task 4, Task 8, Task 9, Task 10
  ↓
Task 13 (aside 接入) ←───── Task 11
  ↓
Task 14 (冒烟验证) ←──────── Task 13
```

**推荐执行顺序：**
1. Task 1 + Task 3（并行：类型 + atoms）
2. Task 2（SSE 服务，依赖 Task 1）
3. Task 12（CSS，无依赖但所有组件需要）
4. Task 4（Session Hook，依赖 Task 1 + 2）
5. Task 5 + Task 6 + Task 8 + Task 9（并行：独立子组件）
6. Task 7（UserMsg + AgentMsg，依赖 Task 5 + 6）
7. Task 10（MessageList，依赖 Task 7）
8. Task 11（AgentPanel 主容器，依赖 Task 4 + 8 + 9 + 10）
9. Task 13（aside 接入）
10. Task 14（冒烟验证）
