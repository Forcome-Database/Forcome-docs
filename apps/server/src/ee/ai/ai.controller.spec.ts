import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

jest.mock('./services/ai.service', () => ({
  AiService: class AiService {},
}));

jest.mock('./services/ai-search.service', () => ({
  AiSearchService: class AiSearchService {},
}));

jest.mock('./services/ai-file.service', () => ({
  AiFileService: class AiFileService {},
}));

jest.mock('./services/ai-template.service', () => ({
  AiTemplateService: class AiTemplateService {},
}));

jest.mock('../../core/page/services/page.service', () => ({
  PageService: class PageService {},
}));

import { AiController } from './ai.controller';

describe('AiController.creatorCommit', () => {
  const workspace = {
    id: 'workspace-1',
    settings: {
      ai: {
        generative: true,
      },
    },
  } as any;

  const user = {
    id: 'user-1',
  } as any;

  function createController() {
    const pageService = {
      commitAiContent: jest.fn(),
    };
    const pageRepo = {
      findById: jest.fn(),
    };
    const spaceAbility = {
      createForUser: jest.fn(),
    };

    const controller = new AiController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pageService as any,
      pageRepo as any,
      spaceAbility as any,
    );

    return {
      controller,
      pageService,
      pageRepo,
      spaceAbility,
    };
  }

  it('throws when the target page does not exist', async () => {
    const { controller, pageRepo } = createController();
    pageRepo.findById.mockResolvedValue(null);

    await expect(
      controller.creatorCommit(
        {
          pageId: 'page-1',
          content: 'draft',
          insertMode: 'overwrite',
          expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
        } as any,
        workspace,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when the user cannot edit the page', async () => {
    const { controller, pageRepo, spaceAbility } = createController();
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      spaceId: 'space-1',
    });
    spaceAbility.createForUser.mockResolvedValue({
      cannot: jest.fn().mockReturnValue(true),
    });

    await expect(
      controller.creatorCommit(
        {
          pageId: 'page-1',
          content: 'draft',
          insertMode: 'overwrite',
          expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
        } as any,
        workspace,
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forwards valid commits to the page service', async () => {
    const { controller, pageService, pageRepo, spaceAbility } =
      createController();
    const page = {
      id: 'page-1',
      spaceId: 'space-1',
    };
    const dto = {
      pageId: 'page-1',
      content: 'draft',
      insertMode: 'replace',
      expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
      selectionSnapshot: {
        from: 1,
        to: 3,
        text: 'hi',
      },
    };

    pageRepo.findById.mockResolvedValue(page);
    spaceAbility.createForUser.mockResolvedValue({
      cannot: jest.fn().mockReturnValue(false),
    });
    pageService.commitAiContent.mockResolvedValue({
      appliedMode: 'replace',
      fallbackReason: null,
      committedAt: '2026-03-12T12:00:05.000Z',
    });

    await expect(
      controller.creatorCommit(dto as any, workspace, user),
    ).resolves.toEqual({
      appliedMode: 'replace',
      fallbackReason: null,
      committedAt: '2026-03-12T12:00:05.000Z',
    });

    expect(pageService.commitAiContent).toHaveBeenCalledWith(
      page,
      {
        content: 'draft',
        insertMode: 'replace',
        expectedUpdatedAt: '2026-03-12T12:00:00.000Z',
        selectionSnapshot: {
          from: 1,
          to: 3,
          text: 'hi',
        },
      },
      user,
    );
  });
});

describe('AiController.creatorGenerate', () => {
  const workspace = {
    id: 'workspace-1',
    settings: {
      ai: {
        generative: true,
      },
    },
  } as any;

  const user = {
    id: 'user-1',
  } as any;

  function createController() {
    const aiService = {
      streamWithContext: jest.fn(),
    };
    const aiFileService = {
      processBufferedFiles: jest.fn(),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn().mockResolvedValue(''),
      getTemplatePrompt: jest.fn().mockResolvedValue(''),
    };

    const controller = new AiController(
      aiService as any,
      {} as any,
      aiFileService as any,
      aiTemplateService as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return {
      controller,
      aiService,
      aiFileService,
    };
  }

  it('rejects file attachments on the standard creator endpoint so uploads must use the MinerU-backed agent flow', async () => {
    const { controller, aiFileService, aiService } = createController();
    const req = {
      parts: async function* () {
        yield {
          type: 'file',
          mimetype: 'application/pdf',
          filename: 'spec.pdf',
          toBuffer: async () => Buffer.from('pdf'),
        };
        yield {
          type: 'field',
          fieldname: 'prompt',
          value: 'summarize this',
        };
      },
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      raw: {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      },
    } as any;

    await expect(
      controller.creatorGenerate(req, workspace, user, res),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(aiFileService.processBufferedFiles).not.toHaveBeenCalled();
    expect(aiService.streamWithContext).not.toHaveBeenCalled();
  });
});
