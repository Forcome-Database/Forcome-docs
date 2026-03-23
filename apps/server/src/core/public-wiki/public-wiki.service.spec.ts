import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { PublicWikiService } from './public-wiki.service';

describe('PublicWikiService.aiAnswers', () => {
  function createService(options?: {
    publicSpaces?: Array<{ id: string; slug: string }>;
    publicPage?: { id: string; slugId: string; spaceId: string; spaceSlug: string } | null;
    aiEnabled?: boolean;
    maxRequests?: number;
  }) {
    const publicSpaces = options?.publicSpaces ?? [{ id: 'space-public', slug: 'docs' }];
    const publicPage =
      options?.publicPage === undefined
        ? {
            id: 'page-public',
            slugId: 'deploy',
            spaceId: 'space-public',
            spaceSlug: 'docs',
          }
        : options.publicPage;

    const db = {
      selectFrom: jest.fn((table: string) => {
        const chain: any = {
          innerJoin: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue(
            table === 'spaces' ? publicSpaces : [],
          ),
          executeTakeFirst: jest.fn().mockResolvedValue(
            table === 'pages'
              ? publicPage && {
                id: publicPage.id,
                slugId: publicPage.slugId,
                spaceId: publicPage.spaceId,
                spaceSlug: publicPage.spaceSlug,
              }
              : null,
          ),
        };
        return chain;
      }),
    };

    const environmentService = {
      getWikiPublicSpaceSlugs: jest.fn().mockReturnValue(['docs']),
      isPublicWikiAiEnabled: jest.fn().mockReturnValue(options?.aiEnabled ?? true),
      getPublicWikiAiRateLimitWindowMs: jest.fn().mockReturnValue(60_000),
      getPublicWikiAiRateLimitMaxRequests: jest.fn().mockReturnValue(options?.maxRequests ?? 5),
      getPublicWikiAiMaxQueryChars: jest.fn().mockReturnValue(500),
      getPublicWikiAiMaxHistoryMessages: jest.fn().mockReturnValue(10),
      getPublicWikiAiMaxHistoryChars: jest.fn().mockReturnValue(1_000),
      getPublicWikiAiMaxImages: jest.fn().mockReturnValue(3),
      getPublicWikiAiMaxImageBytes: jest.fn().mockReturnValue(1024 * 1024),
    };

    const aiSearchService = {
      answerWithContext: jest.fn(async function* (input: any) {
        yield JSON.stringify({ ok: true, input });
      }),
    };

    const service = new PublicWikiService(
      db as any,
      { findById: jest.fn() } as any,
      { findBySlug: jest.fn() } as any,
      { generateAttachmentToken: jest.fn() } as any,
      environmentService as any,
      { searchPage: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(aiSearchService) } as any,
    );

    return {
      service,
      aiSearchService,
    };
  }

  async function collect(generator: AsyncGenerator<string>) {
    const chunks: string[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it('passes a public retrieval scope into ai search', async () => {
    const { service, aiSearchService } = createService();

    await collect(
      service.aiAnswers({
        query: 'where is the runbook',
        workspaceId: 'workspace-1',
        pageSlugId: 'deploy',
        requesterKey: '127.0.0.1',
      }),
    );

    expect(aiSearchService.answerWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        pageSlugId: 'deploy',
        scope: expect.objectContaining({
          isPublicWiki: true,
          allowedSpaceIds: ['space-public'],
          currentPageId: 'page-public',
        }),
      }),
    );
  });

  it('rejects non-public current pages', async () => {
    const { service } = createService({ publicPage: null });

    await expect(
      collect(
        service.aiAnswers({
          query: 'where is the runbook',
          workspaceId: 'workspace-1',
          pageSlugId: 'private-page',
          requesterKey: '127.0.0.1',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces public ai request limits before calling ai search', async () => {
    const { service, aiSearchService } = createService({ maxRequests: 1 });

    await collect(
      service.aiAnswers({
        query: 'first request',
        workspaceId: 'workspace-1',
        requesterKey: '127.0.0.1',
      }),
    );

    await expect(
      collect(
        service.aiAnswers({
          query: 'second request',
          workspaceId: 'workspace-1',
          requesterKey: '127.0.0.1',
        }),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    expect(aiSearchService.answerWithContext).toHaveBeenCalledTimes(1);
  });

  it('rejects requests with oversized history payloads', async () => {
    const { service } = createService();

    await expect(
      collect(
        service.aiAnswers({
          query: 'where is the runbook',
          workspaceId: 'workspace-1',
          requesterKey: '127.0.0.1',
          history: Array.from({ length: 11 }, (_, index) => ({
            role: 'user',
            content: `history-${index}`,
          })),
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
