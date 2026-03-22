import type { SelectionSnapshot } from "./ai-creator.types";
import type {
  AgentAwaitInputData,
  AgentBlockState,
  AgentDraftPatchSection,
  AgentEvidenceSummary,
  AgentSessionRunState,
} from "../../types/agent.types";
import type { CreationBlueprint } from "../../types/blueprint.types";
import type { CreationBrief } from "../../types/brief.types";
import type { ReviewReport } from "../../types/review.types";

export type AiCreateSessionMode = "standard" | "agent";
export type AiCreateSessionStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "blocked"
  | "completed"
  | "error"
  | "cancelled";
export type AiCreateInsertMode = "create" | "append" | "overwrite" | "replace";
export type AiCreateAwaitInputPhase = "brief" | "blueprint" | "review";

export interface AiCreateDocumentTaskSummaryState {
  summarySource: "structured_summary";
  includeRawHistory: false;
  summary: string;
}

export interface AiCreatePendingChange {
  changeId: string;
  label: string;
  content: string;
  insertMode: AiCreateInsertMode;
  selectionSnapshot: SelectionSnapshot | null;
}

export interface AiCreateRollbackSnapshot {
  title: string;
  bodyJson: string;
}

export interface AiCreateDocumentTaskState {
  status: "idle" | "active" | "awaiting_input" | "hydrated" | "completed";
  sourceScope:
    | "selection"
    | "uploaded_document"
    | "uploaded_plus_current_page"
    | "current_page"
    | "blank_page";
  mode: "strict_preservation" | "relaxed_optimization";
  deepCollaborationEnabled: boolean;
  taskSummary: AiCreateDocumentTaskSummaryState;
  plan: Record<string, unknown> | null;
  diffSet: Array<Record<string, unknown>>;
  pendingChangeSet: AiCreatePendingChange[];
  rollbackSnapshot: AiCreateRollbackSnapshot | null;
  draftSections: AgentDraftPatchSection[];
  brief: CreationBrief | null;
  blueprint: CreationBlueprint | null;
  reviewReport: ReviewReport | null;
  evidenceSummary: AgentEvidenceSummary | null;
}

export interface AiCreateInlineRewriteState {
  status: "idle" | "ready";
  selectionSnapshot: SelectionSnapshot | null;
  candidateResult: string | null;
  actionType: string | null;
  taskSummaryRef: {
    summary: string;
    includeRawHistory: false;
  } | null;
}

export interface AiCreateExpertCollabState {
  status: "idle" | "awaiting_decision" | "decision_recorded";
  reason: AiCreateAwaitInputPhase | null;
  question: string | null;
  options: Array<Record<string, unknown>>;
  recommendedOption: string | null;
  confirmedDecision: Record<string, unknown> | null;
  genericMessage: string | null;
}

export interface AiCreateAwaitInputState {
  phase: AiCreateAwaitInputPhase;
  data: AgentAwaitInputData;
}

export interface AiCreateSessionState {
  status: AiCreateSessionStatus;
  mode: AiCreateSessionMode | null;
  insertMode: AiCreateInsertMode | null;
  threadId: string | null;
  taskId: string | null;
  accumulatedContent: string;
  mdBuffer: string;
  startedAt: number | null;
  selectionSnapshot: SelectionSnapshot | null;
  awaitInput: AiCreateAwaitInputState | null;
  block: AgentBlockState | null;
  draftSections: AgentDraftPatchSection[];
  brief: CreationBrief | null;
  blueprint: CreationBlueprint | null;
  reviewReport: ReviewReport | null;
  evidenceSummary: AgentEvidenceSummary | null;
  documentTask: AiCreateDocumentTaskState;
  inlineRewrite: AiCreateInlineRewriteState;
  expertCollab: AiCreateExpertCollabState;
  error: string | null;
}

export type AiCreateSessionAction =
  | { type: "reset" }
  | {
      type: "run_started";
      mode: AiCreateSessionMode;
      insertMode: AiCreateInsertMode;
      selectionSnapshot: SelectionSnapshot | null;
      startedAt: number;
      threadId?: string | null;
    }
  | { type: "session_received"; threadId: string }
  | { type: "task_received"; taskId: string | null }
  | {
      type: "document_task_configured";
      sourceScope: AiCreateDocumentTaskState["sourceScope"];
      mode: AiCreateDocumentTaskState["mode"];
      deepCollaborationEnabled: boolean;
    }
  | { type: "content_delta"; chunk: string }
  | { type: "draft_patch"; markdown: string; sections: AgentDraftPatchSection[] }
  | { type: "content_cleared" }
  | {
      type: "inline_rewrite_updated";
      selectionSnapshot: SelectionSnapshot | null;
      candidateResult: string | null;
      actionType: string | null;
      taskSummaryRef: {
        summary: string;
        includeRawHistory: false;
      } | null;
    }
  | { type: "buffer_updated"; buffer: string }
  | { type: "await_input"; phase: AiCreateAwaitInputPhase; data: AgentAwaitInputData }
  | {
      type: "expert_collab_confirmed";
      reason: AiCreateAwaitInputPhase;
      decision: Record<string, unknown>;
    }
  | {
      type: "pending_changes_prepared";
      pendingChangeSet: AiCreatePendingChange[];
    }
  | {
      type: "apply_completed";
      rollbackSnapshot: AiCreateRollbackSnapshot;
    }
  | { type: "rollback_completed" }
  | { type: "blocked"; block: AgentBlockState }
  | {
      type: "hydrate";
      threadId: string;
      taskId: string | null;
      status: AgentSessionRunState;
      awaitInput: AiCreateAwaitInputState | null;
      block: AgentBlockState | null;
      draftMarkdown: string;
      draftSections: AgentDraftPatchSection[];
      brief: CreationBrief | null;
      blueprint: CreationBlueprint | null;
      reviewReport: ReviewReport | null;
      evidenceSummary: AgentEvidenceSummary | null;
    }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "cancelled" };
