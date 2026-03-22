jest.mock('../../../core/page/services/page.service', () => ({
  PageService: class PageService {},
}));

import { DocumentTasksService } from './document-tasks.service';

describe('DocumentTasksService', () => {
  const agentGatewayService = {
    buildLegacyRunPayload: jest.fn(),
  };
  const pageService = {
    findById: jest.fn(),
    commitAiContent: jest.fn(),
    update: jest.fn(),
  };

  const service = new DocumentTasksService(
    agentGatewayService as any,
    pageService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    agentGatewayService.buildLegacyRunPayload.mockImplementation((payload) => payload);
  });

  it('creates a task-centered shell that keeps legacy routing available behind an adapter', async () => {
    const result = await service.createTask({
      prompt: 'Optimize this uploaded document',
      pageId: 'page-1',
      pageContent: 'Current page',
      pageTitle: 'Draft',
      sourceScope: 'uploaded_document',
      mode: 'strict_preservation',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      files: [],
    });

    expect(agentGatewayService.buildLegacyRunPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Optimize this uploaded document',
        pageId: 'page-1',
        operation: 'create_task',
        documentTask: expect.objectContaining({
          task_type: 'document_transform',
          source_scope: 'uploaded_document',
          mode: 'strict_preservation',
        }),
      }),
    );
    expect(result.operation).toBe('create_task');
    expect(result.task.mode).toBe('strict_preservation');
    expect(result.task.sourceScope).toBe('uploaded_document');
  });

  it('maps plan, diff, review, and collab calls into explicit task operations', async () => {
    const taskId = 'task-1';

    await service.requestPlan(taskId, { summary: 'Preserve structure first' });
    await service.requestDiff(taskId, { confirmedDecisions: [] });
    await service.submitReview(taskId, { acceptedDiffIds: ['diff-1'] });
    await service.resolveCollabDecision(taskId, { decision: 'stay_strict' });

    expect(agentGatewayService.buildLegacyRunPayload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ operation: 'request_plan' }),
    );
    expect(agentGatewayService.buildLegacyRunPayload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operation: 'request_diff' }),
    );
    expect(agentGatewayService.buildLegacyRunPayload).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ operation: 'submit_review' }),
    );
    expect(agentGatewayService.buildLegacyRunPayload).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ operation: 'resolve_collab_decision' }),
    );
  });

  it('applies accepted changes through the server-side page commit path and returns a rollback snapshot', async () => {
    pageService.findById.mockResolvedValue({
      id: 'page-1',
      title: 'Original title',
      content: { type: 'doc', content: [] },
    });
    pageService.commitAiContent.mockResolvedValue({
      appliedMode: 'overwrite',
      fallbackReason: null,
      committedAt: '2026-03-22T08:00:00.000Z',
    });

    const result = await service.applyAcceptedChanges(
      'task-1',
      {
        pageId: 'page-1',
        content: '# Draft',
        insertMode: 'overwrite',
        expectedUpdatedAt: '2026-03-22T07:59:00.000Z',
      },
      { id: 'user-1' },
    );

    expect(pageService.commitAiContent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'page-1',
      }),
      {
        content: '# Draft',
        insertMode: 'overwrite',
        expectedUpdatedAt: '2026-03-22T07:59:00.000Z',
        selectionSnapshot: undefined,
      },
      { id: 'user-1' },
    );
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'applied',
      appliedMode: 'overwrite',
      fallbackReason: null,
      committedAt: '2026-03-22T08:00:00.000Z',
      rollbackSnapshot: {
        title: 'Original title',
        bodyJson: JSON.stringify({ type: 'doc', content: [] }),
      },
    });
  });

  it('restores rollback snapshots through the server-side page update path', async () => {
    pageService.findById.mockResolvedValue({
      id: 'page-1',
      title: 'Changed title',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    pageService.update.mockResolvedValue({
      updatedAt: '2026-03-22T08:05:00.000Z',
    });

    const result = await service.rollbackAppliedChanges(
      'task-1',
      {
        pageId: 'page-1',
        rollbackSnapshot: {
          title: 'Original title',
          bodyJson: JSON.stringify({ type: 'doc', content: [] }),
        },
      },
      { id: 'user-1' },
    );

    expect(pageService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'page-1',
      }),
      {
        title: 'Original title',
        content: { type: 'doc', content: [] },
        operation: 'replace',
        format: 'json',
      },
      { id: 'user-1' },
    );
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'rolled_back',
      restoredAt: '2026-03-22T08:05:00.000Z',
    });
  });
});
