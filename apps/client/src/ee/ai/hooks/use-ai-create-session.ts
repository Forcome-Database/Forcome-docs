import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { getPageById } from "@/features/page/services/page-service";
import { updatePage } from "@/features/page/services/page-service";
import type {
  AgentAwaitInputData,
  AgentResumeValue,
  AgentStepInfo,
} from "../types/agent.types";
import { creatorCommit } from "../services/ai-service";
import {
  applyDocumentTaskAcceptedChanges,
  createDocumentTask,
  rollbackDocumentTaskAppliedChanges,
  runAgentAiCreate,
  runDocumentTaskAgent,
  runStandardAiCreate,
  resumeAgentAiCreate,
  stopAgentAiCreateTask,
} from "../services/ai-create-runner";
import { getAgentSession } from "../services/agent-service";
import type { AiCreateRunEvent } from "../services/ai-create-runner";
import { resolveAiIntent } from "../services/ai-intent";
import type { DocumentTaskMode } from "../types/document-task.types";
import type { SelectionRange } from "../components/ai-creator/ai-creator-atoms";
import {
  aiCreateSessionReducer,
  createInitialAiCreateSessionState,
} from "../components/ai-creator/ai-create-session.reducer";
import {
  createAssistantPlaceholderMessage,
  createHydratedMessages,
  createInteractiveMessage,
  createPendingRunMessages,
} from "../components/ai-creator/ai-create-session.messages";
import { applyAgentStepEvent } from "../components/ai-creator/ai-create-session.steps";
import type {
  AiCreateAwaitInputPhase,
  AiCreateInsertMode,
  AiCreatePendingChange,
  AiCreateSessionMode,
  AiCreateSessionState,
} from "../components/ai-creator/ai-create-session.types";
import { buildCreatorHistory } from "../components/ai-creator/ai-creator-session";
import type {
  AiCreatorMessage,
  SelectionSnapshot,
} from "../components/ai-creator/ai-creator.types";
import {
  captureAiCreatePageSnapshot,
  commitDraftWithRecovery,
} from "./ai-create-session.commit";
import { useDocumentTask } from "./use-document-task";
import { useInlineRewriteSession } from "./use-inline-rewrite";
import { useExpertCollab } from "./use-expert-collab";
import { useTaskApplyRollback } from "./use-task-apply-rollback";

const CONTINUE_KEYWORDS = ["continue", "append"];
const SESSION_STORAGE_PREFIX = "docmost.ai.create.session";

interface UseAiCreateSessionOptions {
  pageId: string;
  editor: any;
  titleEditor?: any;
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

function buildAcceptedDraftPendingChange(args: {
  content: string;
  insertMode: AiCreateInsertMode;
  selectionSnapshot: SelectionSnapshot | null;
}): AiCreatePendingChange {
  return {
    changeId: `pending-${Date.now()}`,
    label:
      args.insertMode === "replace"
        ? "Apply reviewed rewrite"
        : "Apply reviewed article",
    content: args.content,
    insertMode: args.insertMode,
    selectionSnapshot: args.selectionSnapshot,
  };
}

export function shouldPreparePendingChangesForCompletedRun(args: {
  autoInsert: boolean;
  content: string;
  insertMode: AiCreateInsertMode | null;
  pendingReviewAccepted: boolean;
  sourceScope: AiCreateSessionState["documentTask"]["sourceScope"];
}): boolean {
  if (args.autoInsert || !args.content || !args.insertMode) {
    return false;
  }

  if (args.pendingReviewAccepted) {
    return true;
  }

  return args.sourceScope !== "selection";
}

function normalizePageVersion(value?: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function resolveApplyExpectedVersion(
  currentVersion: string | null,
  latestPageUpdatedAt?: string | Date | null,
): string | null {
  return normalizePageVersion(latestPageUpdatedAt) ?? currentVersion;
}

function resolveDocumentTaskSourceScope(
  intent: ReturnType<typeof resolveAiIntent>,
): AiCreateSessionState["documentTask"]["sourceScope"] {
  if (intent.documentTask?.sourceScope) {
    return intent.documentTask.sourceScope;
  }

  if (intent.scope === "selection") {
    return "selection";
  }

  if (intent.scope === "blank_page") {
    return "blank_page";
  }

  return intent.scope;
}

function resolveDocumentTaskMode(
  intent: ReturnType<typeof resolveAiIntent>,
): DocumentTaskMode {
  return intent.documentTask?.mode ?? "strict_preservation";
}

export type AiCreateSubmitTransport =
  | "legacy_standard"
  | "document_task_shell"
  | "inline_rewrite";

export function resolveAiCreateSubmitTransport(args: {
  effectiveMode: "standard" | "agent";
  route: "selection_edit" | "document_transform" | "document_create";
}): AiCreateSubmitTransport {
  if (args.effectiveMode !== "agent") {
    return "legacy_standard";
  }

  if (args.route === "selection_edit") {
    return "inline_rewrite";
  }

  return "document_task_shell";
}

function getSessionStorageKey(pageId: string): string {
  return `${SESSION_STORAGE_PREFIX}:${pageId}`;
}

function readStoredSessionHandle(
  pageId: string,
): { sessionId: string; taskId: string | null } | null {
  if (typeof window === "undefined" || !pageId) {
    return null;
  }

  const raw = window.sessionStorage.getItem(getSessionStorageKey(pageId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      sessionId?: unknown;
      taskId?: unknown;
    };
    if (typeof parsed.sessionId !== "string" || !parsed.sessionId) {
      return null;
    }

    return {
      sessionId: parsed.sessionId,
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
    };
  } catch {
    return null;
  }
}

function writeStoredSessionHandle(
  pageId: string,
  value: { sessionId: string; taskId: string | null },
) {
  if (typeof window === "undefined" || !pageId) {
    return;
  }

  window.sessionStorage.setItem(
    getSessionStorageKey(pageId),
    JSON.stringify(value),
  );
}

function clearStoredSessionHandle(pageId: string) {
  if (typeof window === "undefined" || !pageId) {
    return;
  }

  window.sessionStorage.removeItem(getSessionStorageKey(pageId));
}

export function useAiCreateSession({
  pageId,
  editor,
  titleEditor,
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
  const documentTask = useDocumentTask(state);
  const inlineRewrite = useInlineRewriteSession(state);
  const expertCollab = useExpertCollab(state);
  const applyRollback = useTaskApplyRollback(state);
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
  const pendingReviewAcceptRef = useRef(false);
  const replayedStepRef = useRef<string | null>(null);
  const pageSnapshotRef = useRef(
    captureAiCreatePageSnapshot(editor, titleEditor),
  );
  const pageVersionRef = useRef<string | null>(
    normalizePageVersion(pageUpdatedAt),
  );
  const persistSessionHandle = useCallback(
    (value: { sessionId: string; taskId: string | null } | null) => {
      if (!pageId) {
        return;
      }

      if (!value) {
        clearStoredSessionHandle(pageId);
        return;
      }

      writeStoredSessionHandle(pageId, value);
    },
    [pageId],
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

  const clearLocalConversationState = useCallback(() => {
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
    pendingReviewAcceptRef.current = false;
    startedAtRef.current = null;
    replayedStepRef.current = null;
    clearController();
    dispatch({ type: "reset" });
  }, [clearController, unlockEditor]);

  const resetConversationState = useCallback(() => {
    const taskId = taskIdRef.current;
    clearLocalConversationState();
    persistSessionHandle(null);

    if (taskId) {
      void stopAgentAiCreateTask(taskId).catch(() => {});
    }
  }, [clearLocalConversationState, persistSessionHandle]);

  const hydrateStoredSession = useCallback(async () => {
    clearLocalConversationState();
    const stored = readStoredSessionHandle(pageId);
    if (!stored?.sessionId) {
      return;
    }

    try {
      const snapshot = await getAgentSession(stored.sessionId);
      if (!snapshot) {
        persistSessionHandle(null);
        return;
      }

      threadIdRef.current = snapshot.sessionId;
      taskIdRef.current = snapshot.status === "running" ? stored.taskId : null;
      accumulatedContentRef.current = snapshot.draftMarkdown;
      awaitInputRef.current = snapshot.awaitInput !== null;
      dispatch({
        type: "hydrate",
        threadId: snapshot.sessionId,
        taskId: snapshot.status === "running" ? stored.taskId : null,
        status: snapshot.status,
        awaitInput: snapshot.awaitInput,
        block: snapshot.block,
        draftMarkdown: snapshot.draftMarkdown,
        draftSections: snapshot.draftSections,
        brief: snapshot.brief,
        blueprint: snapshot.blueprint,
        reviewReport: snapshot.reviewReport,
        evidenceSummary: snapshot.evidenceSummary,
      });
      setMessages(
        createHydratedMessages({
          draftMarkdown: snapshot.draftMarkdown,
          awaitInput: snapshot.awaitInput,
        }),
      );
      setSteps([]);
      setIsStreaming(snapshot.status === "running");
      persistSessionHandle({
        sessionId: snapshot.sessionId,
        taskId: snapshot.status === "running" ? stored.taskId : null,
      });
    } catch {
      persistSessionHandle(null);
    }
  }, [clearLocalConversationState, pageId, persistSessionHandle]);

  useEffect(() => {
    void hydrateStoredSession();
  }, [hydrateStoredSession]);

  const addInteractiveMessage = useCallback(
    (phase: AiCreateAwaitInputPhase, data: AgentAwaitInputData) => {
      removeLastEmptyAssistant();
      appendMessage(createInteractiveMessage(phase, data));
      clearController();
      if (threadIdRef.current) {
        persistSessionHandle({
          sessionId: threadIdRef.current,
          taskId: null,
        });
      }
      unlockEditor();
      setIsStreaming(false);
      awaitInputRef.current = true;
      pendingReviewAcceptRef.current = false;
      dispatch({ type: "await_input", phase, data });
    },
    [appendMessage, clearController, removeLastEmptyAssistant, unlockEditor],
  );

  const handleRunError = useCallback(
    (message: string) => {
      removeLastEmptyAssistant();
      clearController();
      if (threadIdRef.current) {
        persistSessionHandle({
          sessionId: threadIdRef.current,
          taskId: null,
        });
      }
      unlockEditor();
      accumulatedContentRef.current = "";
      pendingReviewAcceptRef.current = false;
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
      if (threadIdRef.current) {
        persistSessionHandle({
          sessionId: threadIdRef.current,
          taskId: null,
        });
      }
      dispatch({ type: "done" });
      setIsStreaming(false);
      replayedStepRef.current = null;

      if (
        shouldPreparePendingChangesForCompletedRun({
          autoInsert: autoInsertRef.current,
          content,
          insertMode,
          pendingReviewAccepted: pendingReviewAcceptRef.current,
          sourceScope: stateRef.current.documentTask.sourceScope,
        })
      ) {
        dispatch({
          type: "pending_changes_prepared",
          pendingChangeSet: [
            buildAcceptedDraftPendingChange({
              content,
              insertMode,
              selectionSnapshot,
            }),
          ],
        });
        notifications.show({
          color: "green",
          message: t("Draft is ready. Apply it from Pending Changes."),
        });
      }
      pendingReviewAcceptRef.current = false;

      if (autoInsertRef.current && content && insertMode) {
        const commitResult = await commitDraftWithRecovery({
          pageId,
          content,
          insertMode,
          expectedUpdatedAt: pageVersionRef.current,
          selectionSnapshot,
          pageSnapshot: pageSnapshotRef.current,
          editor,
          titleEditor,
          commit: creatorCommit,
          fetchLatestPage: async (targetPageId) =>
            getPageById({ pageId: targetPageId }),
        });

        if (commitResult.ok === true) {
          pageVersionRef.current = commitResult.result.committedAt;

          if (commitResult.result.fallbackReason === "stale_selection") {
            notifications.show({
              color: "yellow",
              message: t("Selection changed during generation. Content appended to end."),
            });
          }
        } else {
          if (commitResult.reason === "missing_version") {
            notifications.show({
              color: "red",
              message: t("Page version is unavailable. Review the draft and retry."),
            });
          } else {
            const error = commitResult.error;
            const message =
              commitResult.reason === "conflict"
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
    [
      clearController,
      editor,
      pageId,
      t,
      titleEditor,
      unlockEditor,
      updateLastAssistant,
    ],
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
      pendingReviewAcceptRef.current = false;
      accumulatedContentRef.current = "";
      selectionSnapshotRef.current = selectionSnapshot;
      insertModeRef.current = insertMode;
      pageSnapshotRef.current = captureAiCreatePageSnapshot(editor, titleEditor);
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
      persistSessionHandle(null);

      if (autoInsert) {
        lockEditor();
      }

      setIsStreaming(true);
    },
    [editor, lockEditor, persistSessionHandle, titleEditor],
  );

  const handleRunEvent = useCallback(
    (event: AiCreateRunEvent) => {
      switch (event.type) {
        case "task":
          taskIdRef.current = event.taskId;
          dispatch({ type: "task_received", taskId: event.taskId });
          if (threadIdRef.current) {
            persistSessionHandle({
              sessionId: threadIdRef.current,
              taskId: event.taskId,
            });
          }
          return;
        case "session":
          threadIdRef.current = event.sessionId || event.threadId;
          persistSessionHandle({
            sessionId: event.sessionId || event.threadId,
            taskId: taskIdRef.current,
          });
          dispatch({ type: "session_received", threadId: event.sessionId || event.threadId });
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
        case "draft_patch":
          accumulatedContentRef.current = event.markdown;
          dispatch({
            type: "draft_patch",
            markdown: event.markdown,
            sections: event.sections,
          });
          updateLastAssistant(() => event.markdown);
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
          removeLastEmptyAssistant();
          clearController();
          if (threadIdRef.current) {
            persistSessionHandle({
              sessionId: threadIdRef.current,
              taskId: null,
            });
          }
          unlockEditor();
          pendingReviewAcceptRef.current = false;
          dispatch({
            type: "blocked",
            block: {
              kind: event.kind,
              message: event.message,
              requiredAction: event.requiredAction,
              allowedResolutions: event.allowedResolutions,
            },
          });
          setIsStreaming(false);
          return;
        case "done":
          replayedStepRef.current = null;
          if (!awaitInputRef.current) {
            void finalizeRun(event.finalContent);
          } else {
            clearController();
            if (threadIdRef.current) {
              persistSessionHandle({
                sessionId: threadIdRef.current,
                taskId: null,
              });
            }
          }
          return;
        case "cancelled":
          replayedStepRef.current = null;
          clearController();
          if (threadIdRef.current) {
            persistSessionHandle({
              sessionId: threadIdRef.current,
              taskId: null,
            });
          }
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
      persistSessionHandle,
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
      sourceScope: AiCreateSessionState["documentTask"]["sourceScope"],
      mode: DocumentTaskMode,
      deepCollaborationEnabled: boolean,
    ) => {
      setSteps([]);
      controllerRef.current = runAgentAiCreate(
        {
          files: params.files,
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
          documentTask:
            intent.route === "selection_edit"
              ? undefined
              : {
                  task_type:
                    intent.route === "document_create"
                      ? "document_create"
                      : "document_transform",
                  source_scope: sourceScope,
                  mode,
                  deep_collaboration_enabled: deepCollaborationEnabled,
                },
        },
        handleRunEvent,
      );
    },
    [editor, handleRunEvent, pageId],
  );

  const startDocumentTaskRun = useCallback(
    async (
      params: AiCreateSessionSubmitParams,
      intent: ReturnType<typeof resolveAiIntent>,
      sourceScope: AiCreateSessionState["documentTask"]["sourceScope"],
      mode: DocumentTaskMode,
    ) => {
      setSteps([]);

      const normalizedSourceScope =
        sourceScope === "uploaded_document" ||
        sourceScope === "uploaded_plus_current_page" ||
        sourceScope === "current_page"
          ? sourceScope
          : "current_page";

      const shell = await createDocumentTask({
        prompt: params.prompt.trim(),
        pageId,
        pageTitle: params.pageTitle,
        pageContent: editor
          ? editor.state.doc.textBetween(
              0,
              Math.min(5000, editor.state.doc.content.size),
            )
          : undefined,
        sourceScope: normalizedSourceScope,
        mode,
        files: params.files,
        taskType:
          intent.route === "document_create"
            ? "document_create"
            : "document_transform",
      });

      taskIdRef.current = shell.taskId;
      threadIdRef.current = shell.taskId;
      dispatch({ type: "task_received", taskId: shell.taskId });
      dispatch({ type: "session_received", threadId: shell.taskId });
      persistSessionHandle({
        sessionId: shell.taskId,
        taskId: shell.taskId,
      });

      controllerRef.current = runDocumentTaskAgent(
        shell.adapterRequest ?? {},
        handleRunEvent,
      );
    },
    [editor, handleRunEvent, pageId, persistSessionHandle],
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
      const sourceScope = resolveDocumentTaskSourceScope(intent);
      const mode = resolveDocumentTaskMode(intent);
      const submitTransport = resolveAiCreateSubmitTransport({
        effectiveMode: intent.effectiveMode,
        route: intent.route,
      });
      const deepCollaborationEnabled =
        stateRef.current.documentTask.deepCollaborationEnabled;
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
      dispatch({
        type: "document_task_configured",
        sourceScope,
        mode,
        deepCollaborationEnabled,
      });

      if (intent.route === "selection_edit") {
        dispatch({
          type: "inline_rewrite_updated",
          selectionSnapshot: params.selectionRange
            ? {
                text: params.selection,
                from: params.selectionRange.from,
                to: params.selectionRange.to,
              }
            : null,
          candidateResult: null,
          actionType: "selection_edit",
          taskSummaryRef: {
            summary: "Use local selection context only",
            includeRawHistory: false,
          },
        });
      }

      try {
        if (submitTransport === "document_task_shell") {
          await startDocumentTaskRun(params, intent, sourceScope, mode);
          return;
        }

        if (submitTransport === "inline_rewrite") {
          startAgentRun(
            params,
            fullPrompt,
            history,
            insertMode,
            intent,
            sourceScope,
            mode,
            deepCollaborationEnabled,
          );
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
      startDocumentTaskRun,
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

      pendingReviewAcceptRef.current = resumeValue.type === "accept_review";
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
    if (threadIdRef.current) {
      persistSessionHandle({
        sessionId: threadIdRef.current,
        taskId: null,
      });
    }

    if (taskId) {
      void stopAgentAiCreateTask(taskId).catch(() => {});
    }

    unlockEditor();
    removeLastEmptyAssistant();
    awaitInputRef.current = false;
    pendingReviewAcceptRef.current = false;
    accumulatedContentRef.current = "";
    dispatch({ type: "cancelled" });
    setIsStreaming(false);
  }, [removeLastEmptyAssistant, unlockEditor, persistSessionHandle]);

  const applyAcceptedChanges = useCallback(async () => {
    const pendingChange = stateRef.current.documentTask.pendingChangeSet[0];
    if (!pendingChange) {
      return;
    }

    const currentSnapshot = captureAiCreatePageSnapshot(editor, titleEditor);
    if (!currentSnapshot) {
      notifications.show({
        color: "red",
        message: t("Current page snapshot is unavailable. Reload and try again."),
      });
      return;
    }

    const sessionTaskId = stateRef.current.threadId || taskIdRef.current;

    if (!pageVersionRef.current) {
      notifications.show({
        color: "red",
        message: t("Page version is unavailable. Reload and try again."),
      });
      return;
    }

    const latestPage = await getPageById({ pageId });
    const expectedApplyVersion = resolveApplyExpectedVersion(
      pageVersionRef.current,
      latestPage?.updatedAt,
    );

    if (!expectedApplyVersion) {
      notifications.show({
        color: "red",
        message: t("Page version is unavailable. Reload and try again."),
      });
      return;
    }

    pageVersionRef.current = expectedApplyVersion;

    if (!sessionTaskId) {
      const commitResult = await commitDraftWithRecovery({
        pageId,
        content: pendingChange.content,
        insertMode: pendingChange.insertMode,
        expectedUpdatedAt: expectedApplyVersion,
        selectionSnapshot: pendingChange.selectionSnapshot,
        pageSnapshot: currentSnapshot,
        editor,
        titleEditor,
        commit: creatorCommit,
        fetchLatestPage: async (targetPageId) =>
          getPageById({ pageId: targetPageId }),
      });

      if (commitResult.ok) {
        pageVersionRef.current = commitResult.result.committedAt;
        dispatch({
          type: "apply_completed",
          rollbackSnapshot: {
            title: currentSnapshot.title,
            bodyJson: currentSnapshot.bodyJson,
          },
        });
        notifications.show({
          color: "green",
          message: t("Accepted draft applied to the page."),
        });
        return;
      }

      const failedCommitResult = commitResult as Extract<
        typeof commitResult,
        { ok: false }
      >;
      const message =
        failedCommitResult.reason === "missing_version"
          ? t("Page version is unavailable. Reload and try again.")
          : failedCommitResult.reason === "conflict"
            ? t("Page changed before apply. Review the draft and retry.")
            : failedCommitResult.error?.response?.data?.message ||
              failedCommitResult.error?.message ||
              t("Failed to apply the accepted draft.");

      notifications.show({
        color: "red",
        message,
      });
      return;
    }

    try {
      const result = await applyDocumentTaskAcceptedChanges(sessionTaskId, {
        pageId,
        content: pendingChange.content,
        insertMode: pendingChange.insertMode,
        expectedUpdatedAt: expectedApplyVersion,
        selectionSnapshot: pendingChange.selectionSnapshot,
      });

      pageVersionRef.current =
        typeof result.committedAt === "string"
          ? result.committedAt
          : pageVersionRef.current;
      dispatch({
        type: "apply_completed",
        rollbackSnapshot:
          result.rollbackSnapshot && typeof result.rollbackSnapshot === "object"
            ? {
                title: String(
                  (result.rollbackSnapshot as { title?: unknown }).title || "",
                ),
                bodyJson: String(
                  (result.rollbackSnapshot as { bodyJson?: unknown }).bodyJson ||
                    currentSnapshot.bodyJson,
                ),
              }
            : {
                title: currentSnapshot.title,
                bodyJson: currentSnapshot.bodyJson,
              },
      });
      notifications.show({
        color: "green",
        message: t("Accepted draft applied to the page."),
      });
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ||
          error?.message ||
          t("Failed to apply the accepted draft."),
      });
    }
  }, [editor, pageId, t, titleEditor]);

  const rollbackAcceptedChanges = useCallback(async () => {
    const rollbackSnapshot = stateRef.current.documentTask.rollbackSnapshot;
    if (!rollbackSnapshot) {
      return;
    }

    const sessionTaskId = stateRef.current.threadId || taskIdRef.current;

    if (sessionTaskId) {
      try {
        const result = await rollbackDocumentTaskAppliedChanges(sessionTaskId, {
          pageId,
          rollbackSnapshot,
        });

        pageVersionRef.current =
          typeof result.restoredAt === "string"
            ? result.restoredAt
            : pageVersionRef.current;
        dispatch({ type: "rollback_completed" });
        notifications.show({
          color: "green",
          message: t("Rollback snapshot restored."),
        });
        return;
      } catch (error: any) {
        notifications.show({
          color: "red",
          message:
            error?.response?.data?.message ||
            error?.message ||
            t("Failed to restore the rollback snapshot."),
        });
        return;
      }
    }

    try {
      const updatedPage = await updatePage({
        pageId,
        title: rollbackSnapshot.title,
        content: JSON.parse(rollbackSnapshot.bodyJson),
        operation: "replace",
        format: "json",
      } as any);

      pageVersionRef.current = normalizePageVersion(updatedPage.updatedAt);
      dispatch({ type: "rollback_completed" });
      notifications.show({
        color: "green",
        message: t("Rollback snapshot restored."),
      });
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ||
          error?.message ||
          t("Failed to restore the rollback snapshot."),
      });
    }
  }, [pageId, t]);

  const toggleDeepCollaboration = useCallback(() => {
    dispatch({
      type: "document_task_configured",
      sourceScope: stateRef.current.documentTask.sourceScope,
      mode: stateRef.current.documentTask.mode,
      deepCollaborationEnabled:
        !stateRef.current.documentTask.deepCollaborationEnabled,
    });
  }, []);

  return {
    messages,
    steps,
    isStreaming,
    status: state.status,
    awaitInput: state.awaitInput,
    block: state.block,
    draftMarkdown: state.accumulatedContent,
    draftSections: state.draftSections,
    brief: state.brief,
    blueprint: state.blueprint,
    reviewReport: state.reviewReport,
    evidenceSummary: state.evidenceSummary,
    documentTask,
    inlineRewrite,
    expertCollab,
    applyRollback,
    applyAcceptedChanges,
    rollbackAcceptedChanges,
    toggleDeepCollaboration,
    submit,
    resume,
    cancel,
    resetConversation: resetConversationState,
  };
}
