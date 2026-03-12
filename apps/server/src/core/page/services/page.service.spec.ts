import { BadRequestException, ConflictException } from '@nestjs/common';

jest.mock('src/collaboration/collaboration.util', () => ({
  htmlToJson: jest.fn(),
  jsonToNode: jest.fn(),
  jsonToText: jest.fn(),
}));

jest.mock('../../../common/helpers/prosemirror/utils', () => ({
  createYdocFromJson: jest.fn(),
  getAttachmentIds: jest.fn(),
  getProsemirrorContent: jest.fn(),
  isAttachmentNode: jest.fn(),
  removeMarkTypeFromDoc: jest.fn(),
}));

jest.mock('@docmost/editor-ext', () => ({
  markdownToHtml: jest.fn(),
}));

jest.mock('../../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: class CollaborationGateway {},
}));

import { PageService } from './page.service';

describe('PageService.commitAiContent', () => {
  const page = {
    id: 'page-1',
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    creatorId: 'creator-1',
    contributorIds: ['creator-1'],
    updatedAt: new Date('2026-03-12T12:00:00.000Z'),
  } as any;

  const user = {
    id: 'user-1',
  } as any;

  function createService() {
    const pageRepo = {
      findById: jest.fn(),
      updatePage: jest.fn(),
    };
    const collaborationGateway = {
      lockDocument: jest.fn(),
      handleYjsEvent: jest.fn(),
    };

    const service = new PageService(
      pageRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { add: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      collaborationGateway as any,
      {} as any,
    );

    jest
      .spyOn(service as any, 'parseProsemirrorContent')
      .mockResolvedValue({ type: 'doc', content: [] });

    return {
      service,
      pageRepo,
      collaborationGateway,
    };
  }

  it('rejects AI commits when the page version changed', async () => {
    const { service, pageRepo, collaborationGateway } = createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue({
      ...page,
      updatedAt: new Date('2026-03-12T12:00:01.000Z'),
    });

    await expect(
      service.commitAiContent(
        page,
        {
          content: '# Draft',
          insertMode: 'overwrite',
          expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(releaseLock).toHaveBeenCalled();
    expect(collaborationGateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('requires a selection snapshot for replace commits', async () => {
    const { service, pageRepo, collaborationGateway } = createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.commitAiContent(
        page,
        {
          content: 'replacement',
          insertMode: 'replace',
          expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(releaseLock).toHaveBeenCalled();
    expect(collaborationGateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('applies the collaboration commit and returns fallback metadata', async () => {
    const { service, pageRepo, collaborationGateway } = createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue(page);
    collaborationGateway.handleYjsEvent.mockResolvedValue({
      appliedMode: 'append',
      fallbackReason: 'stale_selection',
    });

    const result = await service.commitAiContent(
      page,
      {
        content: 'replacement',
        insertMode: 'replace',
        expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
        selectionSnapshot: {
          from: 1,
          to: 4,
          text: 'old',
        },
      },
      user,
    );

    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'applyAiCommit',
      'page.page-1',
      expect.objectContaining({
        insertMode: 'replace',
        selectionSnapshot: {
          from: 1,
          to: 4,
          text: 'old',
        },
        user,
      }),
    );
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUpdatedById: 'user-1',
        contributorIds: ['creator-1', 'user-1'],
        workspaceId: 'workspace-1',
      }),
      'page-1',
    );
    expect(result.appliedMode).toBe('append');
    expect(result.fallbackReason).toBe('stale_selection');
    expect(typeof result.committedAt).toBe('string');
    expect(releaseLock).toHaveBeenCalled();
  });
});
