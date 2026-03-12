import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('../../collaboration/collaboration.util', () => ({
  jsonToMarkdown: jest.fn().mockReturnValue('Hello'),
}));

import { AiInternalController } from './ai-internal.controller';

describe('AiInternalController', () => {
  function createController() {
    const pageRepo = {
      findById: jest.fn(),
    };
    const aiSearchService = {
      hybridSearch: jest.fn(),
      rerank: jest.fn(),
    };
    const attachmentService = {
      uploadPageImageBuffer: jest.fn(),
    };
    const environmentService = {
      getAgentInternalSecret: jest.fn().mockReturnValue('secret'),
    };

    const controller = new AiInternalController(
      pageRepo as any,
      aiSearchService as any,
      attachmentService as any,
      environmentService as any,
    );

    return {
      controller,
      pageRepo,
      aiSearchService,
      attachmentService,
      req: {
        headers: {
          'x-internal-secret': 'secret',
        },
      } as any,
    };
  }

  it('rejects internal requests with an invalid secret', async () => {
    const { controller, req } = createController();
    req.headers['x-internal-secret'] = 'wrong';

    await expect(
      controller.pageRead({ pageId: 'page-1' }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns markdown page content for page-read', async () => {
    const { controller, pageRepo, req } = createController();
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      title: 'Doc',
      spaceId: 'space-1',
      updatedAt: new Date('2026-03-13T00:00:00.000Z'),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      },
    });

    await expect(
      controller.pageRead({ pageId: 'page-1' }, req),
    ).resolves.toMatchObject({
      pageId: 'page-1',
      title: 'Doc',
      spaceId: 'space-1',
      content: 'Hello',
    });
  });

  it('returns reranked items for knowledge-search', async () => {
    const { controller, aiSearchService, req } = createController();
    aiSearchService.hybridSearch.mockResolvedValue([{ pageId: 'page-1' }]);
    aiSearchService.rerank.mockResolvedValue([
      {
        pageId: 'page-1',
        title: 'Doc',
        slugId: 'doc',
        spaceSlug: 'space',
        chunkText: 'Matched snippet',
        textContent: 'Full text',
      },
    ]);

    await expect(
      controller.knowledgeSearch(
        { workspaceId: 'workspace-1', query: 'doc', limit: 3 },
        req,
      ),
    ).resolves.toEqual({
      items: [
        {
          pageId: 'page-1',
          title: 'Doc',
          slugId: 'doc',
          spaceSlug: 'space',
          content: 'Matched snippet',
        },
      ],
    });
  });

  it('uploads base64 images to the current page', async () => {
    const { controller, pageRepo, attachmentService, req } = createController();
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      creatorId: 'user-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    });
    attachmentService.uploadPageImageBuffer.mockResolvedValue({
      id: 'file-1',
      fileName: 'image.png',
    });

    await expect(
      controller.uploadPageImage(
        {
          pageId: 'page-1',
          filename: 'image.png',
          fileContentB64: Buffer.from('img').toString('base64'),
        },
        req,
      ),
    ).resolves.toEqual({
      fileId: 'file-1',
      fileName: 'image.png',
      url: '/api/files/file-1/image.png',
    });
  });

  it('rejects incomplete upload payloads', async () => {
    const { controller, req } = createController();

    await expect(
      controller.uploadPageImage(
        {
          pageId: 'page-1',
          filename: '',
          fileContentB64: '',
        },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when upload target page does not exist', async () => {
    const { controller, pageRepo, req } = createController();
    pageRepo.findById.mockResolvedValue(null);

    await expect(
      controller.uploadPageImage(
        {
          pageId: 'page-1',
          filename: 'image.png',
          fileContentB64: Buffer.from('img').toString('base64'),
        },
        req,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
