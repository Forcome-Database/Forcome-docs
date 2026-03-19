import type {
  AiCreateSessionAction,
  AiCreateSessionState,
} from "./ai-create-session.types";

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
    case "content_delta":
      return {
        ...state,
        accumulatedContent: state.accumulatedContent + action.chunk,
      };
    case "draft_patch":
      return {
        ...state,
        accumulatedContent: action.markdown,
        mdBuffer: action.markdown,
        draftSections: action.sections,
      };
    case "content_cleared":
      return {
        ...state,
        accumulatedContent: "",
        mdBuffer: "",
      };
    case "buffer_updated":
      return {
        ...state,
        mdBuffer: action.buffer,
      };
    case "await_input":
      return {
        ...state,
        status: "awaiting_input",
        taskId: null,
        awaitInput: {
          phase: action.phase,
          data: action.data,
        },
        block: null,
        brief: action.phase === "brief" && "brief" in action.data ? action.data.brief : state.brief,
        blueprint:
          action.phase === "blueprint" && "blueprint" in action.data
            ? action.data.blueprint
            : state.blueprint,
        reviewReport:
          action.phase === "review" && "report" in action.data
            ? action.data.report
            : state.reviewReport,
        error: null,
      };
    case "blocked":
      return {
        ...state,
        status: "blocked",
        taskId: null,
        awaitInput: null,
        block: action.block,
        error: null,
      };
    case "hydrate":
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
        draftSections: action.draftSections,
        brief: action.brief,
        blueprint: action.blueprint,
        reviewReport: action.reviewReport,
        evidenceSummary: action.evidenceSummary,
        error: null,
      };
    case "done":
      return {
        ...state,
        status: "completed",
        taskId: null,
        awaitInput: null,
        block: null,
        error: null,
      };
    case "error":
      return {
        ...state,
        status: "error",
        taskId: null,
        awaitInput: null,
        block: null,
        error: action.message,
      };
    case "cancelled":
      return {
        ...state,
        status: "cancelled",
        taskId: null,
        awaitInput: null,
        block: null,
        error: null,
      };
    default:
      return state;
  }
}
