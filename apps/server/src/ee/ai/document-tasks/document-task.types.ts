export type DocumentTaskMode =
  | 'strict_preservation'
  | 'relaxed_optimization';

export type DocumentTaskStatus =
  | 'idle'
  | 'analyzing'
  | 'awaiting_plan_confirmation'
  | 'generating_diff'
  | 'awaiting_review'
  | 'ready_to_apply'
  | 'applied'
  | 'error';

export type DocumentTaskSourceScope =
  | 'uploaded_document'
  | 'current_page'
  | 'uploaded_plus_current_page';

export type DocumentTaskDiffGranularity = 'block' | 'text';

export interface DocumentTaskGuardrails {
  preserveMeaning: true;
  preserveImageTextCorrespondence: true;
}

export interface DocumentTaskStrategyDefaults {
  documentTaskMode: DocumentTaskMode | null;
  documentSourceScope: DocumentTaskSourceScope | null;
  taskSummarySource: 'structured_summary';
  includeRawHistory: false;
  guardrails: DocumentTaskGuardrails;
}

export interface DocumentTaskDiffTextMetadata {
  granularity: 'text';
  format: 'line';
}

export interface DocumentTaskDiffEntry {
  diffId: string;
  blockId: string;
  granularity: 'block';
  textDiff: DocumentTaskDiffTextMetadata | null;
}

export interface DocumentTaskApplyPayload {
  taskId: string;
  acceptedDiffIds: string[];
  createRollbackSnapshot: true;
}

export interface DocumentTaskRollbackPayload {
  taskId: string;
  rollbackRef: string;
}

export function normalizeDocumentTaskSourceScope(
  scope: string,
): DocumentTaskSourceScope | null {
  switch (scope) {
    case 'uploaded_document':
    case 'current_page':
    case 'uploaded_plus_current_page':
      return scope;
    default:
      return null;
  }
}

export function resolveDocumentTaskStrategyDefaults(params: {
  intentRoute: string;
  scope: string;
  documentTaskMode?: DocumentTaskMode | null;
}): DocumentTaskStrategyDefaults {
  return {
    documentTaskMode:
      params.intentRoute === 'document_transform'
        ? (params.documentTaskMode ?? 'strict_preservation')
        : null,
    documentSourceScope:
      params.intentRoute === 'document_transform'
        ? normalizeDocumentTaskSourceScope(params.scope)
        : null,
    taskSummarySource: 'structured_summary',
    includeRawHistory: false,
    guardrails: {
      preserveMeaning: true,
      preserveImageTextCorrespondence: true,
    },
  };
}

export function createDefaultDocumentTaskDiffSet(): DocumentTaskDiffEntry[] {
  return [
    {
      diffId: 'diff-1',
      blockId: 'block-1',
      granularity: 'block',
      textDiff: {
        granularity: 'text',
        format: 'line',
      },
    },
  ];
}

export function createDefaultDocumentTaskApplyPayload(): DocumentTaskApplyPayload {
  return {
    taskId: 'task-1',
    acceptedDiffIds: ['diff-1'],
    createRollbackSnapshot: true,
  };
}

export function createDefaultDocumentTaskRollbackPayload(): DocumentTaskRollbackPayload {
  return {
    taskId: 'task-1',
    rollbackRef: 'rollback-1',
  };
}
