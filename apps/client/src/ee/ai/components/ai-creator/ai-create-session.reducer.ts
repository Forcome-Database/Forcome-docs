import type {
  AiCreateSessionAction,
  AiCreateSessionState,
} from "./ai-create-session.types";

function createDocumentTaskState(): AiCreateSessionState["documentTask"] {
  return {
    status: "idle",
    sourceScope: "current_page",
    mode: "strict_preservation",
    deepCollaborationEnabled: true,
    taskSummary: {
      summarySource: "structured_summary",
      includeRawHistory: false,
      summary: "",
    },
    plan: null,
    diffSet: [],
    pendingChangeSet: [],
    rollbackSnapshot: null,
    draftSections: [],
    brief: null,
    blueprint: null,
    reviewReport: null,
    evidenceSummary: null,
  };
}

function createInlineRewriteState(): AiCreateSessionState["inlineRewrite"] {
  return {
    status: "idle",
    selectionSnapshot: null,
    candidateResult: null,
    actionType: null,
    taskSummaryRef: null,
  };
}

function createExpertCollabState(): AiCreateSessionState["expertCollab"] {
  return {
    status: "idle",
    reason: null,
    question: null,
    options: [],
    recommendedOption: null,
    confirmedDecision: null,
    genericMessage: null,
  };
}

function summarizeDocumentTask(
  state: Pick<
    AiCreateSessionState,
    "brief" | "blueprint" | "reviewReport" | "draftSections"
  >,
): string {
  if (state.reviewReport) {
    return `Review score ${state.reviewReport.overall_score}`;
  }
  if (state.blueprint?.title) {
    return state.blueprint.title;
  }
  if (state.brief?.goal) {
    return state.brief.goal;
  }
  if (state.draftSections?.[0]?.title) {
    return state.draftSections[0].title;
  }
  return "";
}

export function createInitialAiCreateSessionState(): AiCreateSessionState {
  return {
    status: "idle",
    mode: null,
    insertMode: null,
    threadId: null,
    taskId: null,
    accumulatedContent: "",
    mdBuffer: "",
    startedAt: null,
    selectionSnapshot: null,
    awaitInput: null,
    block: null,
    draftSections: [],
    brief: null,
    blueprint: null,
    reviewReport: null,
    evidenceSummary: null,
    documentTask: createDocumentTaskState(),
    inlineRewrite: createInlineRewriteState(),
    expertCollab: createExpertCollabState(),
    error: null,
  };
}

export function aiCreateSessionReducer(
  state: AiCreateSessionState,
  action: AiCreateSessionAction,
): AiCreateSessionState {
  switch (action.type) {
    case "reset":
      return createInitialAiCreateSessionState();
    case "run_started":
      return {
        status: "running",
        mode: action.mode,
        insertMode: action.insertMode,
        threadId: action.threadId ?? null,
        taskId: null,
        accumulatedContent: "",
        mdBuffer: "",
        startedAt: action.startedAt,
        selectionSnapshot: action.selectionSnapshot,
        awaitInput: null,
        block: null,
        draftSections: [],
        brief: null,
        blueprint: null,
        reviewReport: null,
        evidenceSummary: null,
        documentTask: createDocumentTaskState(),
        inlineRewrite: createInlineRewriteState(),
        expertCollab: createExpertCollabState(),
        error: null,
      };
    case "session_received":
      return {
        ...state,
        threadId: action.threadId,
      };
    case "task_received":
      return {
        ...state,
        taskId: action.taskId,
      };
    case "document_task_configured":
      return {
        ...state,
        documentTask: {
          ...state.documentTask,
          sourceScope: action.sourceScope,
          mode: action.mode,
          deepCollaborationEnabled: action.deepCollaborationEnabled,
        },
      };
    case "content_delta":
      return {
        ...state,
        accumulatedContent: state.accumulatedContent + action.chunk,
        inlineRewrite:
          state.inlineRewrite.status === "ready"
            ? {
                ...state.inlineRewrite,
                candidateResult:
                  (state.inlineRewrite.candidateResult || "") + action.chunk,
              }
            : state.inlineRewrite,
      };
    case "draft_patch":
      return {
        ...state,
        accumulatedContent: action.markdown,
        mdBuffer: action.markdown,
        draftSections: action.sections,
        documentTask: {
          ...state.documentTask,
          status: "active",
          draftSections: action.sections,
          taskSummary: {
            ...state.documentTask.taskSummary,
            summary: action.sections[0]?.title || state.documentTask.taskSummary.summary,
          },
        },
      };
    case "content_cleared":
      return {
        ...state,
        accumulatedContent: "",
        mdBuffer: "",
      };
    case "inline_rewrite_updated":
      return {
        ...state,
        inlineRewrite: {
          status: action.selectionSnapshot ? "ready" : "idle",
          selectionSnapshot: action.selectionSnapshot,
          candidateResult: action.candidateResult,
          actionType: action.actionType,
          taskSummaryRef: action.taskSummaryRef,
        },
      };
    case "buffer_updated":
      return {
        ...state,
        mdBuffer: action.buffer,
      };
    case "await_input":
      const nextBrief =
        action.phase === "brief" && "brief" in action.data ? action.data.brief : state.brief;
      const nextBlueprint =
        action.phase === "blueprint" && "blueprint" in action.data
          ? action.data.blueprint
          : state.blueprint;
      const nextReview =
        action.phase === "review" && "report" in action.data
          ? action.data.report
          : state.reviewReport;

      return {
        ...state,
        status: "awaiting_input",
        taskId: null,
        awaitInput: {
          phase: action.phase,
          data: action.data,
        },
        block: null,
        brief: nextBrief,
        blueprint: nextBlueprint,
        reviewReport: nextReview,
        documentTask: {
          ...state.documentTask,
          status: "awaiting_input",
          brief: nextBrief,
          blueprint: nextBlueprint,
          reviewReport: nextReview,
          draftSections: state.draftSections,
          evidenceSummary: state.evidenceSummary,
          plan: nextBlueprint
            ? (nextBlueprint as unknown as Record<string, unknown>)
            : state.documentTask.plan,
          taskSummary: {
            summarySource: "structured_summary",
            includeRawHistory: false,
            summary: summarizeDocumentTask({
              brief: nextBrief,
              blueprint: nextBlueprint,
              reviewReport: nextReview,
              draftSections: state.draftSections,
            }),
          },
        },
        expertCollab: {
          ...(state.documentTask.deepCollaborationEnabled
            ? {
                status: "awaiting_decision" as const,
                reason: action.phase,
                question: `Confirm ${action.phase}`,
                options: [{ id: "confirm" }, { id: "revise" }],
                recommendedOption: "confirm",
                confirmedDecision: null,
                genericMessage: null,
              }
            : createExpertCollabState()),
        },
        error: null,
      };
    case "expert_collab_confirmed":
      return {
        ...state,
        expertCollab: {
          ...state.expertCollab,
          status: "decision_recorded",
          reason: action.reason,
          confirmedDecision: action.decision,
          genericMessage: null,
        },
      };
    case "pending_changes_prepared":
      return {
        ...state,
        documentTask: {
          ...state.documentTask,
          pendingChangeSet: action.pendingChangeSet,
        },
      };
    case "apply_completed":
      return {
        ...state,
        status: "completed",
        documentTask: {
          ...state.documentTask,
          pendingChangeSet: [],
          rollbackSnapshot: action.rollbackSnapshot,
        },
      };
    case "rollback_completed":
      return {
        ...state,
        documentTask: {
          ...state.documentTask,
          rollbackSnapshot: null,
        },
      };
    case "blocked":
      return {
        ...state,
        status: "blocked",
        taskId: null,
        awaitInput: null,
        block: action.block,
        expertCollab: createExpertCollabState(),
        error: null,
      };
    case "hydrate":
      const hydratedDocumentTask = {
        ...state.documentTask,
        status: "hydrated" as const,
        rollbackSnapshot: null,
        draftSections: action.draftSections ?? [],
        brief: action.brief ?? null,
        blueprint: action.blueprint ?? null,
        reviewReport: action.reviewReport ?? null,
        evidenceSummary: action.evidenceSummary ?? null,
        plan: action.blueprint
          ? (action.blueprint as unknown as Record<string, unknown>)
          : null,
        taskSummary: {
          summarySource: "structured_summary" as const,
          includeRawHistory: false as const,
          summary: summarizeDocumentTask({
            brief: action.brief ?? null,
            blueprint: action.blueprint ?? null,
            reviewReport: action.reviewReport ?? null,
            draftSections: action.draftSections ?? [],
          }),
        },
      };
      return {
        ...state,
        status: action.status,
        mode: "agent",
        threadId: action.threadId,
        taskId: action.taskId,
        accumulatedContent: action.draftMarkdown,
        mdBuffer: action.draftMarkdown,
        awaitInput: action.awaitInput,
        block: action.block,
        draftSections: action.draftSections ?? [],
        brief: action.brief ?? null,
        blueprint: action.blueprint ?? null,
        reviewReport: action.reviewReport ?? null,
        evidenceSummary: action.evidenceSummary ?? null,
        documentTask: hydratedDocumentTask,
        expertCollab: action.awaitInput
          ? hydratedDocumentTask.deepCollaborationEnabled
            ? {
                status: "awaiting_decision",
                reason: action.awaitInput.phase,
                question: `Confirm ${action.awaitInput.phase}`,
                options: [{ id: "confirm" }, { id: "revise" }],
                recommendedOption: "confirm",
                confirmedDecision: null,
                genericMessage: null,
              }
            : createExpertCollabState()
          : createExpertCollabState(),
        error: null,
      };
    case "done":
      return {
        ...state,
        status: "completed",
        taskId: null,
        awaitInput: null,
        block: null,
        documentTask: {
          ...state.documentTask,
          status: "completed",
        },
        expertCollab: createExpertCollabState(),
        error: null,
      };
    case "error":
      return {
        ...state,
        status: "error",
        taskId: null,
        awaitInput: null,
        block: null,
        expertCollab: createExpertCollabState(),
        error: action.message,
      };
    case "cancelled":
      return {
        ...state,
        status: "cancelled",
        taskId: null,
        awaitInput: null,
        block: null,
        expertCollab: createExpertCollabState(),
        error: null,
      };
    default:
      return state;
  }
}
