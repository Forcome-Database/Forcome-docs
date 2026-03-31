import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { agentV2Run } from "../services/agent-v2-service";
import api from "@/lib/api-client";
import type {
  AgentMessage,
  AgentSessionAPI,
  AgentSessionStatus,
  AgentV2Event,
  TimelineItem,
} from "../types/agent-v2.types";

export function useAgentSession(pageId: string): AgentSessionAPI {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<AgentSessionStatus>("idle");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<string | null>(null);
  const [outputType, setOutputType] = useState<"document" | "conversation" | null>(null);
  const [editMode, setEditMode] = useState<"replace" | "insert" | "full" | null>(null);
  const taskIdRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timelineRef = useRef<TimelineItem[]>([]);
  const assistantIdRef = useRef("");

  const editor = useAtomValue(pageEditorAtom);

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

  /** 获取 timeline 末尾的指定类型项（用于追加式累积） */
  const lastTimelineItem = (kind: string) => {
    const items = timelineRef.current;
    const last = items[items.length - 1];
    return last?.kind === kind ? last : null;
  };

  const handleEvent = useCallback(
    (event: AgentV2Event) => {
      switch (event.type) {
        case "session":
          setThreadId(event.thread_id);
          taskIdRef.current = (event as any).task_id || null;
          break;

        case "thinking": {
          setStatus("thinking");
          // 追加到末尾的 thinking 项，或新建
          const existing = lastTimelineItem("thinking") as Extract<TimelineItem, { kind: "thinking" }> | null;
          if (existing) {
            existing.content += event.chunk || "";
          } else {
            timelineRef.current.push({ kind: "thinking", content: event.chunk || "" });
          }
          updateLastAssistant(() => ({
            timeline: [...timelineRef.current],
          }));
          break;
        }

        case "content": {
          setStatus("streaming");
          // 追加到末尾的 text 项（如果它还不是 narration），或新建
          const existing = lastTimelineItem("text") as Extract<TimelineItem, { kind: "text" }> | null;
          if (existing && !existing.isNarration) {
            existing.content += event.chunk;
          } else {
            timelineRef.current.push({ kind: "text", content: event.chunk, isNarration: false });
          }
          updateLastAssistant(() => ({
            timeline: [...timelineRef.current],
            streaming: true,
          }));
          break;
        }

        case "tool_call": {
          // 回溯降级：当收到 tool_call 时，说明 Agent 仍在收集阶段，
          // 之前流式输出的 text 实际是 Agent 的分析叙述（而非最终文档）。
          // 将这些 text 项标记为 narration，前端以可折叠"规划"块展示。
          // 只有最后一轮（所有 tool_call 完成后）的 text 才是最终文档。
          for (const item of timelineRef.current) {
            if (item.kind === "text" && !item.isNarration) {
              item.isNarration = true;
            }
          }
          // 添加 tool 项
          timelineRef.current.push({
            kind: "tool",
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tool: event.tool,
            description: event.description,
            status: "running",
          });
          updateLastAssistant(() => ({
            timeline: [...timelineRef.current],
          }));
          break;
        }

        case "tool_result":
          // 更新最后一个 running 的 tool 项
          for (let i = timelineRef.current.length - 1; i >= 0; i--) {
            const item = timelineRef.current[i];
            if (item.kind === "tool" && item.status === "running") {
              item.status = "done";
              break;
            }
          }
          updateLastAssistant(() => ({
            timeline: [...timelineRef.current],
          }));
          break;

        case "warning":
          updateLastAssistant(() => ({
            warnings: event.issues,
          }));
          break;

        case "retrying":
          // Quality retry：清空当前 timeline 中的文档内容，等待重新生成
          for (const item of timelineRef.current) {
            if (item.kind === "text" && !item.isNarration) {
              item.content = "";
            }
          }
          updateLastAssistant(() => ({
            timeline: [...timelineRef.current],
          }));
          break;

        case "content_clear":
          // Quality retry 重新生成前清空文档内容
          for (const item of timelineRef.current) {
            if (item.kind === "text" && !item.isNarration) {
              item.content = "";
            }
          }
          updateLastAssistant(() => ({
            timeline: [...timelineRef.current],
          }));
          break;

        case "done": {
          setStatus("done");
          // 使用后端提供的权威输出（仅最终轮文档，不含中间叙述）
          const finalContent = event.final_content || "";
          setLastOutput(finalContent);
          setOutputType(event.output_type || "document");
          setEditMode((event as any).edit_mode || "full");
          // 同步 content 字段（供 Apply to page 使用）
          updateLastAssistant(() => ({
            content: finalContent,
            streaming: false,
          }));
          break;
        }

        case "error":
          setStatus("error");
          updateLastAssistant(() => ({
            content: `Error: ${event.message}`,
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

  const lockEditor = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(false);
    editor.view.dom.classList.add("ai-generating");
  }, [editor]);

  const unlockEditor = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(true);
    editor.view.dom.classList.remove("ai-generating");
  }, [editor]);

  // Ensure editor is unlocked if component unmounts during streaming
  useEffect(() => {
    return () => {
      unlockEditor();
    };
  }, [unlockEditor]);

  const submit = useCallback(
    async (prompt: string, files?: File[], pageContent?: string, selection?: {
      editMode: string;
      selectedText?: string;
      contextBefore?: string;
      contextAfter?: string;
      documentOutline?: string;
    }) => {
      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
        files: files?.map((f) => f.name),
        // Store selection snapshot with the message — immutable once submitted
        selectionSnapshot: selection ? {
          mode: (selection.editMode as "replace" | "insert" | "full") || "full",
          from: (selection as any).from ?? null,
          to: (selection as any).to ?? null,
          selectedText: selection.selectedText ?? null,
          anchorBefore: (selection as any).anchorBefore ?? "",
          anchorAfter: (selection as any).anchorAfter ?? "",
          preview: selection.selectedText
            ? selection.selectedText.substring(0, 120).replace(/\n/g, " ")
            : selection.editMode === "insert" ? "Insert at cursor" : "",
        } : undefined,
      };

      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        timeline: [],
        streaming: true,
      };
      assistantIdRef.current = assistantMsg.id;

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus("streaming");
      setLastOutput(null);
      timelineRef.current = [];

      lockEditor();

      abortRef.current = agentV2Run(
        { prompt, pageId, threadId: threadId ?? undefined, pageContent, files, selection },
        handleEvent,
        (error) => {
          setStatus("error");
          updateLastAssistant(() => ({
            content: `Error: ${error}`,
            streaming: false,
          }));
        },
        () => {
          unlockEditor();
        },
      );
    },
    [pageId, threadId, handleEvent, updateLastAssistant, lockEditor, unlockEditor],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("cancelled");
    updateLastAssistant(() => ({ streaming: false }));
    unlockEditor();
    // Signal the server to stop the LLM call (saves token costs)
    if (taskIdRef.current) {
      api.post("/agent/stop", { taskId: taskIdRef.current }).catch(() => {});
      taskIdRef.current = null;
    }
  }, [updateLastAssistant, unlockEditor]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStatus("idle");
    setThreadId(null);
    setLastOutput(null);
    setOutputType(null);
    setEditMode(null);
    timelineRef.current = [];
    assistantIdRef.current = "";
  }, []);

  return { messages, status, threadId, lastOutput, outputType, editMode, submit, cancel, reset };
}
