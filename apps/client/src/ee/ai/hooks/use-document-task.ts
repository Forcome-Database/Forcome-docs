import { useMemo } from "react";
import type {
  AiCreateDocumentTaskState,
  AiCreateSessionState,
} from "../components/ai-creator/ai-create-session.types";
import type { AgentDraftPatchSection, AgentEvidenceSummary } from "../types/agent.types";
import type { CreationBlueprint } from "../types/blueprint.types";
import type { CreationBrief } from "../types/brief.types";
import type { ReviewReport } from "../types/review.types";

interface DeriveDocumentTaskStateParams {
  status?: AiCreateSessionState["status"];
  brief: CreationBrief | null;
  blueprint: CreationBlueprint | null;
  reviewReport: ReviewReport | null;
  draftSections: AgentDraftPatchSection[];
  evidenceSummary: AgentEvidenceSummary | null;
  rawMessages?: Array<{ role: string; content: string }>;
}

function summarizeTask(params: DeriveDocumentTaskStateParams): string {
  if (params.reviewReport) {
    return `Review score ${params.reviewReport.overall_score}`;
  }
  if (params.blueprint?.title) {
    return params.blueprint.title;
  }
  if (params.brief?.goal) {
    return params.brief.goal;
  }
  if (params.draftSections[0]?.title) {
    return params.draftSections[0].title;
  }
  return "";
}

export function createInitialDocumentTaskState(): AiCreateDocumentTaskState {
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

export function deriveDocumentTaskState(
  params: DeriveDocumentTaskStateParams,
): AiCreateDocumentTaskState {
  return {
    status:
      params.status === "awaiting_input"
        ? "awaiting_input"
        : params.status === "completed"
          ? "completed"
          : params.status
            ? "active"
            : "idle",
    sourceScope: "current_page",
    mode: "strict_preservation",
    deepCollaborationEnabled: true,
    taskSummary: {
      summarySource: "structured_summary",
      includeRawHistory: false,
      summary: summarizeTask(params),
    },
    plan: params.blueprint
      ? (params.blueprint as unknown as Record<string, unknown>)
      : null,
    diffSet: [],
    pendingChangeSet: [],
    rollbackSnapshot: null,
    draftSections: params.draftSections,
    brief: params.brief,
    blueprint: params.blueprint,
    reviewReport: params.reviewReport,
    evidenceSummary: params.evidenceSummary,
  };
}

export function useDocumentTask(state: AiCreateSessionState): AiCreateDocumentTaskState {
  return useMemo(
    () =>
      state.documentTask ??
      deriveDocumentTaskState({
        status: state.status,
        brief: state.brief,
        blueprint: state.blueprint,
        reviewReport: state.reviewReport,
        draftSections: state.draftSections,
        evidenceSummary: state.evidenceSummary,
      }),
    [state],
  );
}
