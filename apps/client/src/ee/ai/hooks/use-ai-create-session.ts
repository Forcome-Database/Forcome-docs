import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import type {
  AgentAwaitInputData,
  AgentResumeValue,
  AgentStepInfo,
} from "../types/agent.types";
import { creatorCommit } from "../services/ai-service";
import {
  runAgentAiCreate,
  runStandardAiCreate,
  resumeAgentAiCreate,
  stopAgentAiCreateTask,
} from "../services/ai-create-runner";
import type { AiCreateRunEvent } from "../services/ai-create-runner";
import { resolveAiIntent } from "../services/ai-intent";
import type { SelectionRange } from "../components/ai-creator/ai-creator-atoms";
import {
  aiCreateSessionReducer,
  createInitialAiCreateSessionState,
} from "../components/ai-creator/ai-create-session.reducer";
import {
  createAssistantPlaceholderMessage,
  createInteractiveMessage,
  createPendingRunMessages,
} from "../components/ai-creator/ai-create-session.messages";
import { applyAgentStepEvent } from "../components/ai-creator/ai-create-session.steps";
import type {
  AiCreateAwaitInputPhase,
  AiCreateInsertMode,
  AiCreateSessionMode,
  AiCreateSessionState,
} from "../components/ai-creator/ai-create-session.types";
import { buildCreatorHistory } from "../components/ai-creator/ai-creator-session";
import type {
  AiCreatorMessage,
  SelectionSnapshot,
} from "../components/ai-creator/ai-creator.types";

const CONTINUE_KEYWORDS = ["continue", "append"];

interface UseAiCreateSessionOptions {
  pageId: string;
  editor: any;
  pageUpdatedAt?: string | Date | null;
  lockEditor: () => void;
  unlockEditor: () => void;
}

export interface AiCreateSessionSubmitParams {
  prompt: string;
  files: File[];
  template: string | null;
  selection: string;
  selectionRange: SelectionRange | null;
  autoInsert: boolean;
  agentMode: boolean;
  pageHasContent: boolean;
  pageTitle: string;
}

function buildPrompt(prompt: string, selection: string): string {
  if (!selection) {
    return prompt;
  }

  return (
    `[CRITICAL INSTRUCTION]\n` +
    `The user has selected a specific portion of text for you to modify.\n` +
    `You MUST ONLY output the modified version of the selected text below.\n` +
    `STRICTLY FORBIDDEN: Do NOT rewrite the entire article, do NOT add content outside the scope of the selected text, do NOT output any surrounding context.\n` +
    `Only return the replacement for the selected text, nothing more.\n\n` +
    `[Selected text to modify]\n${selection}\n\n` +
    `[User request]\n${prompt}`
  );
}

function isContinueIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return CONTINUE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function resolveInsertMode(
  prompt: string,
  selection: string,
  pageHasContent: boolean,
): AiCreateInsertMode {
  if (selection) {
    return "replace";
  }

  if (!pageHasContent) {
    return "create";
  }

  return isContinueIntent(prompt) ? "append" : "overwrite";
}

function formatElapsed(startedAt: number | null): string | null {
  if (!startedAt) {
    return null;
  }

  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function normalizePageVersion(value?: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function useAiCreateSession({
  pageId,
  editor,
  pageUpdatedAt,
  lockEditor,
  unlockEditor,
}: UseAiCreateSessionOptions) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    aiCreateSessionReducer,
    undefined,
    createInitialAiCreateSessionState,
  );
  const [messages, setMessages] = useState<AiCreatorMessage[]>([]);
  const [steps, setSteps] = useState<AgentStepInfo[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const stateRef = useRef<AiCreateSessionState>(state);
  const controllerRef = useRef<AbortController | null>(null);
  const accumulatedContentRef = useRef("");
  const selectionSnapshotRef = useRef<SelectionSnapshot | null>(null);
  const insertModeRef = useRef<AiCreateInsertMode | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const autoInsertRef = useRef(false);
  const awaitInputRef = useRef(false);
  const replayedStepRef = useRef<string | null>(null);
  const pageVersionRef = useRef<string | null>(
    normalizePageVersion(pageUpdatedAt),
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    pageVersionRef.current = normalizePageVersion(pageUpdatedAt);
  }, [pageUpdatedAt]);

  const appendMessage = useCallback((message: AiCreatorMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateLastAssistant = useCallback(
    (updater: (content: string) => string) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: updater(last.content),
          };
        }
        return next;
      });
    },
    [],
  );

  const removeLastEmptyAssistant = useCallback(() => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && !last.content.trim()) {
        next.pop();
      }
      return next;
    });
  }, []);

  const clearController = useCallback(() => {
    controllerRef.current = null;
    taskIdRef.current = null;
    dispatch({ type: "task_received", taskId: null });
  }, []);

  const resetConversationState = useCallback(() => {
    const taskId = taskIdRef.current;
    controllerRef.current?.abort();
    unlockEditor();
    setMessages([]);
    setSteps([]);
    setIsStreaming(false);
    awaitInputRef.current = false;
    autoInsertRef.current = false;
    accumulatedContentRef.current = "";
    selectionSnapshotRef.current = null;
    insertModeRef.current = null;
    threadIdRef.current = null;
    startedAtRef.current = null;
    replayedStepRef.current = null;
    clearController();
    dispatch({ type: "reset" });

    if (taskId) {
      void stopAgentAiCreateTask(taskId).catch(() => {});
    }
  }, [clearController, unlockEditor]);

  const addInteractiveMessage = useCallback(
    (phase: AiCreateAwaitInputPhase, data: AgentAwaitInputData) => {
      removeLastEmptyAssistant();
      appendMessage(createInteractiveMessage(phase, data));
      clearController();
      unlockEditor();
      setIsStreaming(false);
      awaitInputRef.current = true;
      dispatch({ type: "await_input", phase, data });
    },
    [appendMessage, clearController, removeLastEmptyAssistant, unlockEditor],
  );

  const handleRunError = useCallback(
    (message: string) => {
      removeLastEmptyAssistant();
      clearController();
      unlockEditor();
      accumulatedContentRef.current = "";
      replayedStepRef.current = null;
      dispatch({ type: "error", message });
      setIsStreaming(false);
      notifications.show({ color: "red", message });
    },
    [clearController, removeLastEmptyAssistant, unlockEditor],
  );

  const finalizeRun = useCallback(
    async (finalContent?: string) => {
      const insertMode = insertModeRef.current;
      const selectionSnapshot = selectionSnapshotRef.current;
      const content = finalContent || accumulatedContentRef.current;

      clearController();
      dispatch({ type: "done" });
      setIsStreaming(false);
      replayedStepRef.current = null;

      if (autoInsertRef.current && content && insertMode) {
        const expectedUpdatedAt = pageVersionRef.current;

        if (!expectedUpdatedAt) {
          notifications.show({
            color: "red",
            message: t("Page version is unavailable. Review the draft and retry."),
          });
        } else {
          try {
            const result = await creatorCommit({
              pageId,
              content,
              insertMode,
              expectedUpdatedAt,
              selectionSnapshot,
            });

            pageVersionRef.current = result.committedAt;

            if (result.fallbackReason === "stale_selection") {
              notifications.show({
                color: "yellow",
                message: t("Selection changed during generation. Content appended to end."),
              });
            }
          } catch (error: any) {
            const message =
              error?.response?.status === 409
                ? t("Page changed during generation. Draft kept in chat for retry or manual insert.")
                : error?.response?.data?.message ||
                  error?.message ||
                  t("Failed to apply AI output to the page. Draft kept in chat.");

            notifications.show({
              color: "red",
              message,
            });
          }
        }
      }

      unlockEditor();
      accumulatedContentRef.current = "";

      const elapsed = formatElapsed(startedAtRef.current);
      if (elapsed) {
        updateLastAssistant(
          (existing) => `${finalContent || existing}\n\n---\n*${elapsed}s*`,
        );
      }
    },
    [clearController, pageId, t, unlockEditor, updateLastAssistant],
  );

  const updateStep = useCallback(
    (
      event:
        | { type: "step_start"; step: string; description: string }
        | { type: "step_done"; step: string; resultSummary?: string },
    ) => {
      setSteps((prev) => {
        const result = applyAgentStepEvent(
          prev,
          event,
          replayedStepRef.current,
        );
        replayedStepRef.current = result.replayedStep;
        return result.steps;
      });
    },
    [],
  );

  const prepareRun = useCallback(
    (
      mode: AiCreateSessionMode,
      insertMode: AiCreateInsertMode,
      selectionRange: SelectionRange | null,
      autoInsert: boolean,
    ) => {
      const selectionSnapshot: SelectionSnapshot | null =
        selectionRange && editor
          ? {
              text: editor.state.doc.textBetween(
                selectionRange.from,
                selectionRange.to,
              ),
              from: selectionRange.from,
              to: selectionRange.to,
            }
          : null;

      autoInsertRef.current = autoInsert;
      awaitInputRef.current = false;
      accumulatedContentRef.current = "";
      selectionSnapshotRef.current = selectionSnapshot;
      insertModeRef.current = insertMode;
      threadIdRef.current = null;
      startedAtRef.current = Date.now();
      dispatch({
        type: "run_started",
        mode,
        insertMode,
        selectionSnapshot,
        startedAt: startedAtRef.current,
        threadId: null,
      });

      if (autoInsert) {
        lockEditor();
      }

      setIsStreaming(true);
    },
    [editor, lockEditor],
  );

  const handleRunEvent = useCallback(
    (event: AiCreateRunEvent) => {
      switch (event.type) {
        case "task":
          taskIdRef.current = event.taskId;
          dispatch({ type: "task_received", taskId: event.taskId });
          return;
        case "session":
          threadIdRef.current = event.threadId;
          dispatch({ type: "session_received", threadId: event.threadId });
          return;
        case "step_start":
          updateStep({
            type: "step_start",
            step: event.step,
            description: event.description,
          });
          return;
        case "step_done":
          updateStep({
            type: "step_done",
            step: event.step,
            resultSummary: event.resultSummary,
          });
          return;
        case "content_delta":
          accumulatedContentRef.current += event.chunk;
          dispatch({ type: "content_delta", chunk: event.chunk });
          updateLastAssistant(() => accumulatedContentRef.current);
          return;
        case "content_cleared":
          accumulatedContentRef.current = "";
          dispatch({ type: "content_cleared" });
          updateLastAssistant(() => "");
          return;
        case "await_input":
          replayedStepRef.current = null;
          addInteractiveMessage(event.phase, event.data);
          return;
        case "error":
          replayedStepRef.current = null;
          handleRunError(event.message);
          return;
        case "blocked":
          replayedStepRef.current = null;
          handleRunError(event.message);
          return;
        case "done":
          replayedStepRef.current = null;
          if (!awaitInputRef.current) {
            void finalizeRun(event.finalContent);
          } else {
            clearController();
          }
          return;
        case "cancelled":
          replayedStepRef.current = null;
          clearController();
          unlockEditor();
          accumulatedContentRef.current = "";
          dispatch({ type: "cancelled" });
          setIsStreaming(false);
          return;
        default:
          return;
      }
    },
    [
      addInteractiveMessage,
      clearController,
      finalizeRun,
      handleRunError,
      unlockEditor,
      updateLastAssistant,
      updateStep,
    ],
  );

  const startStandardRun = useCallback(
    async (
      params: AiCreateSessionSubmitParams,
      fullPrompt: string,
      history: { role: "user" | "assistant"; content: string }[],
      insertMode: AiCreateInsertMode,
      intent: ReturnType<typeof resolveAiIntent>,
    ) => {
      controllerRef.current = await runStandardAiCreate(
        {
          files: params.files,
          prompt: fullPrompt,
          template: params.template || undefined,
          pageId,
          pageContent:
            intent.route === "document_transform" && editor
              ? editor.state.doc.textBetween(
                  0,
                  Math.min(8000, editor.state.doc.content.size),
                )
              : undefined,
          insertMode,
          existingContentSummary:
            insertMode === "append" && editor
              ? editor.state.doc.textBetween(
                  0,
                  Math.min(500, editor.state.doc.content.size),
                )
              : undefined,
          pageTitle: params.pageTitle,
          history: history.length > 0 ? history : undefined,
          intentRoute: intent.route,
          scope: intent.scope,
          sourcePolicy: intent.sourcePolicy,
          lengthPolicy: intent.lengthPolicy,
          prioritizeUserInstructions: intent.prioritizeUserInstructions,
        },
        handleRunEvent,
      );
    },
    [editor, handleRunEvent, pageId],
  );

  const startAgentRun = useCallback(
    (
      params: AiCreateSessionSubmitParams,
      fullPrompt: string,
      history: { role: "user" | "assistant"; content: string }[],
      insertMode: AiCreateInsertMode,
      intent: ReturnType<typeof resolveAiIntent>,
    ) => {
      setSteps([]);
      controllerRef.current = runAgentAiCreate(
        {
          prompt: fullPrompt,
          pageId,
          templateId: params.template || undefined,
          insertMode,
          pageTitle: params.pageTitle,
          pageContent: editor
            ? editor.state.doc.textBetween(
                0,
                Math.min(5000, editor.state.doc.content.size),
              )
            : undefined,
          selectedText: params.selection || undefined,
          conversationHistory: history.length > 0 ? history : undefined,
          intentRoute: intent.route,
        },
        handleRunEvent,
      );
    },
    [editor, handleRunEvent, pageId],
  );

  const submit = useCallback(
    async (params: AiCreateSessionSubmitParams) => {
      if (!params.prompt.trim() || isStreaming) {
        return;
      }

      const userPrompt = params.prompt.trim();
      const fullPrompt = buildPrompt(userPrompt, params.selection);
      const history = buildCreatorHistory(messages);
      const insertMode = resolveInsertMode(
        userPrompt,
        params.selection,
        params.pageHasContent,
      );
      const intent = resolveAiIntent({
        prompt: userPrompt,
        selection: params.selection,
        files: params.files,
        pageHasContent: params.pageHasContent,
        agentMode: params.agentMode,
      });
      setSteps([]);

      const [userMessage, assistantMessage] = createPendingRunMessages({
        prompt: userPrompt,
        selection: params.selection,
        selectionRange: params.selectionRange,
      });
      appendMessage(userMessage);
      appendMessage(assistantMessage);

      prepareRun(
        intent.effectiveMode,
        insertMode,
        params.selectionRange,
        params.autoInsert,
      );

      try {
        if (intent.effectiveMode === "agent") {
          startAgentRun(params, fullPrompt, history, insertMode, intent);
          return;
        }

        await startStandardRun(params, fullPrompt, history, insertMode, intent);
      } catch (error: any) {
        handleRunError(error.message || t("Failed to start AI creation"));
      }
    },
    [
      appendMessage,
      handleRunError,
      isStreaming,
      messages,
      prepareRun,
      startAgentRun,
      startStandardRun,
      t,
    ],
  );

  const resume = useCallback(
    (resumeValue: AgentResumeValue) => {
      const currentState = stateRef.current;
      if (!threadIdRef.current) {
        return;
      }

      awaitInputRef.current = false;
      const startedAt = Date.now();
      appendMessage(createAssistantPlaceholderMessage());
      dispatch({
        type: "run_started",
        mode: currentState.mode || "agent",
        insertMode: insertModeRef.current || "overwrite",
        selectionSnapshot: selectionSnapshotRef.current,
        startedAt,
        threadId: threadIdRef.current,
      });
      startedAtRef.current = startedAt;
      accumulatedContentRef.current = "";
      replayedStepRef.current = currentState.awaitInput?.phase ?? null;
      if (autoInsertRef.current) {
        lockEditor();
      }
      setIsStreaming(true);

      controllerRef.current = resumeAgentAiCreate(
        threadIdRef.current,
        resumeValue,
        handleRunEvent,
      );
    },
    [appendMessage, handleRunEvent, lockEditor],
  );

  const cancel = useCallback(() => {
    const taskId = taskIdRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;
    taskIdRef.current = null;
    replayedStepRef.current = null;

    if (taskId) {
      void stopAgentAiCreateTask(taskId).catch(() => {});
    }

    unlockEditor();
    removeLastEmptyAssistant();
    awaitInputRef.current = false;
    accumulatedContentRef.current = "";
    dispatch({ type: "cancelled" });
    setIsStreaming(false);
  }, [removeLastEmptyAssistant, unlockEditor]);

  return {
    messages,
    steps,
    isStreaming,
    status: state.status,
    submit,
    resume,
    cancel,
    resetConversation: resetConversationState,
  };
}
