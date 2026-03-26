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
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const lockEditor = useCallback(() => {
    if (!editor) return;
    editor.setEditable(false);
    editor.view.dom.classList.add("ai-generating");
  }, [editor]);

  const unlockEditor = useCallback(() => {
    if (!editor) return;
    editor.setEditable(true);
    editor.view.dom.classList.remove("ai-generating");
  }, [editor]);

  const submit = useCallback(
    async (prompt: string, files?: File[]) => {
      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
        files: files?.map((f) => f.name),
      };

      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
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

      lockEditor();

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
  }, [updateLastAssistant, unlockEditor]);

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
