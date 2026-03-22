import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { DocumentTaskMode, DocumentTaskSourceScope } from './document-task.types';
import { AgentGatewayService } from '../agent-gateway/agent-gateway.service';
import { PageService } from '../../../core/page/services/page.service';

type DocumentTaskOperation =
  | 'create_task'
  | 'request_plan'
  | 'request_diff'
  | 'submit_review'
  | 'apply_accepted_changes'
  | 'rollback_applied_changes'
  | 'resolve_collab_decision';

interface CreateDocumentTaskParams {
  prompt: string;
  pageId?: string;
  pageTitle?: string;
  pageContent?: string;
  taskType?: 'document_transform' | 'document_create';
  sourceScope?: DocumentTaskSourceScope;
  mode?: DocumentTaskMode;
  workspaceId: string;
  userId: string;
  files?: Array<{ filename: string; mimetype: string; content_b64: string }>;
}

interface DocumentTaskApplyPayload {
  pageId: string;
  content: string;
  insertMode: 'create' | 'append' | 'overwrite' | 'replace';
  expectedUpdatedAt: string;
  selectionSnapshot?: {
    text: string;
    from: number;
    to: number;
  };
}

interface DocumentTaskRollbackPayload {
  pageId: string;
  rollbackSnapshot: {
    title: string;
    bodyJson: string;
  };
}

export interface DocumentTaskShellResult {
  taskId: string;
  operation: DocumentTaskOperation;
  task: {
    taskId: string;
    taskType: 'document_transform' | 'document_create';
    sourceScope: DocumentTaskSourceScope;
    mode: DocumentTaskMode;
    status: 'analyzing' | 'awaiting_plan_confirmation' | 'generating_diff';
  };
  adapterRequest: Record<string, unknown>;
}

@Injectable()
export class DocumentTasksService {
  constructor(
    private readonly agentGatewayService: AgentGatewayService,
    private readonly pageService: PageService,
  ) {}

  private buildShellResult(params: {
    taskId: string;
    operation: DocumentTaskOperation;
    taskType?: 'document_transform' | 'document_create';
    sourceScope?: DocumentTaskSourceScope;
    mode?: DocumentTaskMode;
    prompt?: string;
    pageId?: string;
    pageTitle?: string;
    pageContent?: string;
    workspaceId?: string;
    files?: Array<{ filename: string; mimetype: string; content_b64: string }>;
    payload?: Record<string, unknown>;
  }): DocumentTaskShellResult {
    const sourceScope = params.sourceScope || 'current_page';
    const mode = params.mode || 'strict_preservation';
    const taskType = params.taskType || 'document_transform';
    const status =
      params.operation === 'create_task'
        ? 'analyzing'
        : params.operation === 'request_plan'
          ? 'awaiting_plan_confirmation'
          : 'generating_diff';

    const adapterRequest = this.agentGatewayService.buildLegacyRunPayload({
      prompt:
        params.prompt ||
        (typeof params.payload?.summary === 'string'
          ? params.payload.summary
          : `${params.operation}:${params.taskId}`),
      pageId: params.pageId,
      pageTitle: params.pageTitle,
      pageContent: params.pageContent,
      intentRoute:
        taskType === 'document_create' ? 'document_create' : 'document_transform',
      insertMode: 'create',
      threadId: params.taskId,
      workspaceId: params.workspaceId || '',
      files: params.files || [],
      operation: params.operation,
      documentTask: {
        task_id: params.taskId,
        task_type: taskType,
        source_scope: sourceScope,
        mode,
      },
      conversationHistory: [],
      payload: params.payload,
    });

    return {
      taskId: params.taskId,
      operation: params.operation,
      task: {
        taskId: params.taskId,
        taskType,
        sourceScope,
        mode,
        status,
      },
      adapterRequest,
    };
  }

  async createTask(params: CreateDocumentTaskParams): Promise<DocumentTaskShellResult> {
    const taskId = randomUUID();
    return this.buildShellResult({
      taskId,
      operation: 'create_task',
      taskType: params.taskType,
      sourceScope: params.sourceScope,
      mode: params.mode,
      prompt: params.prompt,
      pageId: params.pageId,
      pageTitle: params.pageTitle,
      pageContent: params.pageContent,
      workspaceId: params.workspaceId,
      files: params.files,
    });
  }

  async requestPlan(
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<DocumentTaskShellResult> {
    return this.buildShellResult({
      taskId,
      operation: 'request_plan',
      payload,
    });
  }

  async requestDiff(
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<DocumentTaskShellResult> {
    return this.buildShellResult({
      taskId,
      operation: 'request_diff',
      payload,
    });
  }

  async submitReview(
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<DocumentTaskShellResult> {
    return this.buildShellResult({
      taskId,
      operation: 'submit_review',
      payload,
    });
  }

  async applyAcceptedChanges(
    taskId: string,
    payload: DocumentTaskApplyPayload,
    user: any,
  ): Promise<{
    taskId: string;
    status: 'applied';
    appliedMode: 'append' | 'overwrite' | 'replace';
    fallbackReason: 'stale_selection' | null;
    committedAt: string;
    rollbackSnapshot: {
      title: string;
      bodyJson: string;
    };
  }> {
    const page = await this.pageService.findById(payload.pageId, true);
    const rollbackSnapshot = {
      title: page?.title || '',
      bodyJson: JSON.stringify(page?.content || { type: 'doc', content: [] }),
    };

    const result = await this.pageService.commitAiContent(
      page,
      {
        content: payload.content,
        insertMode: payload.insertMode,
        expectedUpdatedAt: payload.expectedUpdatedAt,
        selectionSnapshot: payload.selectionSnapshot,
      },
      user,
    );

    return {
      taskId,
      status: 'applied',
      appliedMode: result.appliedMode,
      fallbackReason: result.fallbackReason,
      committedAt: result.committedAt,
      rollbackSnapshot,
    };
  }

  async rollbackAppliedChanges(
    taskId: string,
    payload: DocumentTaskRollbackPayload,
    user: any,
  ): Promise<{
    taskId: string;
    status: 'rolled_back';
    restoredAt: string;
  }> {
    const page = await this.pageService.findById(payload.pageId, true);
    const updatedPage = await this.pageService.update(
      page,
      {
        title: payload.rollbackSnapshot.title,
        content: JSON.parse(payload.rollbackSnapshot.bodyJson),
        operation: 'replace',
        format: 'json',
      } as any,
      user,
    );

    return {
      taskId,
      status: 'rolled_back',
      restoredAt:
        updatedPage.updatedAt instanceof Date
          ? updatedPage.updatedAt.toISOString()
          : String(updatedPage.updatedAt),
    };
  }

  async resolveCollabDecision(
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<DocumentTaskShellResult> {
    return this.buildShellResult({
      taskId,
      operation: 'resolve_collab_decision',
      payload,
    });
  }
}
