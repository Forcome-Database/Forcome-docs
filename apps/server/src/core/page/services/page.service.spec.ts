import { BadRequestException, ConflictException } from '@nestjs/common';
import { AiCommitSelectionConflictError } from '../../../ee/ai/creator-commit.utils';

jest.mock('src/collaboration/collaboration.util', () => ({
  htmlToJson: jest.fn(),
  jsonToNode: jest.fn(),
  jsonToText: jest.fn(),
}));

jest.mock('../../../common/helpers/prosemirror/utils', () => {
  const actual = jest.requireActual('../../../common/helpers/prosemirror/utils');
  return {
    ...actual,
    createYdocFromJson: jest.fn(),
    getAttachmentIds: jest.fn(),
    getProsemirrorContent: jest.fn(),
    isAttachmentNode: jest.fn(),
    removeMarkTypeFromDoc: jest.fn(),
  };
});

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
    const attachmentRepo = {
      findByPageId: jest.fn().mockResolvedValue([]),
    };
    const collaborationGateway = {
      lockDocument: jest.fn(),
      handleYjsEvent: jest.fn(),
    };

    const service = new PageService(
      pageRepo as any,
      attachmentRepo as any,
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
      attachmentRepo,
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

  it('allows replace commits to continue when only the page version changed', async () => {
    const { service, pageRepo, collaborationGateway } = createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue({
      ...page,
      updatedAt: new Date('2026-03-12T12:00:01.000Z'),
    });
    collaborationGateway.handleYjsEvent.mockResolvedValue({
      appliedMode: 'replace',
      fallbackReason: null,
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

    expect(result.appliedMode).toBe('replace');
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
      }),
    );
    expect(releaseLock).toHaveBeenCalled();
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

  it('surfaces stale selection rewrite conflicts instead of silently appending', async () => {
    const { service, pageRepo, collaborationGateway } = createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue(page);
    collaborationGateway.handleYjsEvent.mockRejectedValue(
      new AiCommitSelectionConflictError(),
    );

    await expect(
      service.commitAiContent(
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
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
  });

  it('extracts the first H1 into the page title and strips it from committed body content', async () => {
    const { service, pageRepo, collaborationGateway } = createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue({
      ...page,
      title: null,
    });
    collaborationGateway.handleYjsEvent.mockResolvedValue({
      appliedMode: 'overwrite',
      fallbackReason: null,
    });
    jest.spyOn(service as any, 'parseProsemirrorContent').mockResolvedValue({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'AI Generated Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body paragraph' }],
        },
      ],
    });

    await service.commitAiContent(
      page,
      {
        content: '# AI Generated Title\n\nBody paragraph',
        insertMode: 'overwrite',
        expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
      },
      user,
    );

    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'applyAiCommit',
      'page.page-1',
      expect.objectContaining({
        prosemirrorJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Body paragraph' }],
            },
          ],
        },
      }),
    );
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'AI Generated Title',
      }),
      'page-1',
    );
  });

  it('canonicalizes malformed internal image URLs against page attachments before commit', async () => {
    const { service, pageRepo, attachmentRepo, collaborationGateway } =
      createService();
    const releaseLock = jest.fn().mockResolvedValue(undefined);

    collaborationGateway.lockDocument.mockResolvedValue(releaseLock);
    pageRepo.findById.mockResolvedValue(page);
    attachmentRepo.findByPageId.mockResolvedValue([
      {
        id: '019d159b-9ca8-734c-9306-2d45bd0cad65',
        fileName: 'clash配置教程_8249b1b5.jpg',
      },
    ]);
    collaborationGateway.handleYjsEvent.mockResolvedValue({
      appliedMode: 'overwrite',
      fallbackReason: null,
    });
    jest.spyOn(service as any, 'parseProsemirrorContent').mockResolvedValue({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: '/api/files/019d159b-ca8-734c-9306-2d45bd0cad65/clash%E9%85%8D%E7%BD%AE%E6%95%99%E7%A8%8B_8249b1b5.jpg',
          },
        },
      ],
    });

    await service.commitAiContent(
      page,
      {
        content:
          '![x](/api/files/019d159b-ca8-734c-9306-2d45bd0cad65/clash%E9%85%8D%E7%BD%AE%E6%95%99%E7%A8%8B_8249b1b5.jpg)',
        insertMode: 'overwrite',
        expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
      },
      user,
    );

    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'applyAiCommit',
      'page.page-1',
      expect.objectContaining({
        prosemirrorJson: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                attachmentId: '019d159b-9ca8-734c-9306-2d45bd0cad65',
                src: '/api/files/019d159b-9ca8-734c-9306-2d45bd0cad65/clash%E9%85%8D%E7%BD%AE%E6%95%99%E7%A8%8B_8249b1b5.jpg',
              },
            },
          ],
        },
      }),
    );
  });
});
