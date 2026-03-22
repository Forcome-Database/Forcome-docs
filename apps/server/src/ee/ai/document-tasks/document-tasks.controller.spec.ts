jest.mock('../../../core/page/services/page.service', () => ({
  PageService: class PageService {},
}));

import { DocumentTasksController } from './document-tasks.controller';

describe('DocumentTasksController', () => {
  const service = {
    createTask: jest.fn(),
    requestPlan: jest.fn(),
    requestDiff: jest.fn(),
    submitReview: jest.fn(),
    applyAcceptedChanges: jest.fn(),
    rollbackAppliedChanges: jest.fn(),
    resolveCollabDecision: jest.fn(),
  };

  const controller = new DocumentTasksController(service as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a document task through the task-centered shell', async () => {
    service.createTask.mockResolvedValue({ taskId: 'task-1', operation: 'create_task' });

    const result = await controller.createTask(
      {
        body: {
          prompt: 'Optimize this uploaded document',
          pageId: 'page-1',
          pageContent: 'Current page',
          sourceScope: 'uploaded_document',
          mode: 'strict_preservation',
        },
      } as any,
      { id: 'user-1' },
      { id: 'workspace-1' },
    );

    expect(service.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Optimize this uploaded document',
        pageId: 'page-1',
        sourceScope: 'uploaded_document',
        mode: 'strict_preservation',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    );
    expect(result).toEqual({ taskId: 'task-1', operation: 'create_task' });
  });

  it('falls back to the JSON body when Fastify exposes multipart helpers on a non-multipart request', async () => {
    service.createTask.mockResolvedValue({ taskId: 'task-2', operation: 'create_task' });

    const result = await controller.createTask(
      {
        body: {
          prompt: 'Optimize the current page',
          pageId: 'page-2',
          sourceScope: 'current_page',
          mode: 'strict_preservation',
        },
        headers: {
          'content-type': 'application/json',
        },
        parts: () => {
          throw new Error('parts() should not be called for JSON requests');
        },
      } as any,
      { id: 'user-1' },
      { id: 'workspace-1' },
    );

    expect(service.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Optimize the current page',
        pageId: 'page-2',
        sourceScope: 'current_page',
        mode: 'strict_preservation',
      }),
    );
    expect(result).toEqual({ taskId: 'task-2', operation: 'create_task' });
  });

  it('exposes plan, diff, review, apply, rollback, and collab endpoints', async () => {
    service.requestPlan.mockResolvedValue({ taskId: 'task-1', operation: 'request_plan' });
    service.requestDiff.mockResolvedValue({ taskId: 'task-1', operation: 'request_diff' });
    service.submitReview.mockResolvedValue({ taskId: 'task-1', operation: 'submit_review' });
    service.applyAcceptedChanges.mockResolvedValue({
      taskId: 'task-1',
      operation: 'apply_accepted_changes',
    });
    service.rollbackAppliedChanges.mockResolvedValue({
      taskId: 'task-1',
      operation: 'rollback_applied_changes',
    });
    service.resolveCollabDecision.mockResolvedValue({
      taskId: 'task-1',
      operation: 'resolve_collab_decision',
    });

    await expect(
      controller.requestPlan('task-1', { summary: 'Need a preservation plan' }),
    ).resolves.toEqual({
      taskId: 'task-1',
      operation: 'request_plan',
    });
    await expect(
      controller.requestDiff('task-1', { confirmedDecisions: [] }),
    ).resolves.toEqual({
      taskId: 'task-1',
      operation: 'request_diff',
    });
    await expect(
      controller.submitReview('task-1', { acceptedDiffIds: ['diff-1'] }),
    ).resolves.toEqual({
      taskId: 'task-1',
      operation: 'submit_review',
    });
    await expect(
      controller.applyAcceptedChanges(
        'task-1',
        { acceptedDiffIds: ['diff-1'] },
        { id: 'user-1' },
      ),
    ).resolves.toEqual({
      taskId: 'task-1',
      operation: 'apply_accepted_changes',
    });
    await expect(
      controller.rollbackAppliedChanges(
        'task-1',
        { rollbackRef: 'rollback-1' },
        { id: 'user-1' },
      ),
    ).resolves.toEqual({
      taskId: 'task-1',
      operation: 'rollback_applied_changes',
    });
    await expect(
      controller.resolveCollabDecision('task-1', { decision: 'stay_strict' }),
    ).resolves.toEqual({
      taskId: 'task-1',
      operation: 'resolve_collab_decision',
    });
  });
});
