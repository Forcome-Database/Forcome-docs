export type DocumentTaskMode =
  | "strict_preservation"
  | "relaxed_optimization";

export type DocumentTaskStatus =
  | "idle"
  | "analyzing"
  | "awaiting_plan_confirmation"
  | "generating_diff"
  | "awaiting_review"
  | "ready_to_apply"
  | "applied"
  | "error";

export type DocumentTaskSourceScope =
  | "uploaded_document"
  | "current_page"
  | "uploaded_plus_current_page";

export type DocumentTaskDiffGranularity = "block" | "text";

export interface DocumentTaskGuardrails {
  preserveMeaning: true;
  preserveImageTextCorrespondence: true;
}

export interface DocumentTaskDiffDefaults {
  reviewMode: "diff_first";
  defaultGranularity: "block";
  supportedGranularity: DocumentTaskDiffGranularity[];
}

export interface DocumentTaskIntentDefaults {
  mode: DocumentTaskMode;
  sourceScope: DocumentTaskSourceScope;
  taskSummarySource: "structured_summary";
  includeRawHistory: false;
  diff: DocumentTaskDiffDefaults;
  guardrails: DocumentTaskGuardrails;
}

export function createDocumentTaskIntentDefaults(
  mode: DocumentTaskMode,
  sourceScope: DocumentTaskSourceScope,
): DocumentTaskIntentDefaults {
  return {
    mode,
    sourceScope,
    taskSummarySource: "structured_summary",
    includeRawHistory: false,
    diff: {
      reviewMode: "diff_first",
      defaultGranularity: "block",
      supportedGranularity: ["block", "text"],
    },
    guardrails: {
      preserveMeaning: true,
      preserveImageTextCorrespondence: true,
    },
  };
}
