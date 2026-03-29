import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { PublicWikiService } from './public-wiki.service';

describe('PublicWikiService.aiAnswers', () => {
  function createRedisMultiMock(requestCount = 0) {
    const multi: any = {
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 0],              // zremrangebyscore result
        [null, requestCount],   // zcard result (current count)
        [null, 1],              // zadd result
        [null, 1],              // pexpire result
      ]),
    };
    return multi;
  }

  function createService(options?: {
    publicSpaces?: Array<{ id: string; slug: string }>;
    publicPage?: { id: string; slugId: string; spaceId: string; spaceSlug: string } | null;
    aiEnabled?: boolean;
    maxRequests?: number;
    redisRequestCount?: number;
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
      getPublicWikiAiAllowedOrigins: jest.fn().mockReturnValue([]),
    };

    const aiSearchService = {
      answerWithContext: jest.fn(async function* (input: any) {
        yield JSON.stringify({ ok: true, input });
      }),
    };

    const multiMock = createRedisMultiMock(options?.redisRequestCount ?? 0);
    const redisMock = {
      multi: jest.fn().mockReturnValue(multiMock),
      zremrangebyscore: jest.fn().mockResolvedValue(0),
    };
    const redisServiceMock = {
      getOrThrow: jest.fn().mockReturnValue(redisMock),
    };
    const conversationStoreMock = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PublicWikiService(
      db as any,
      { findById: jest.fn() } as any,
      { findBySlug: jest.fn() } as any,
      { generateAttachmentToken: jest.fn() } as any,
      environmentService as any,
      { searchPage: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(aiSearchService) } as any,
      redisServiceMock as any,
      conversationStoreMock as any,
    );

    return {
      service,
      aiSearchService,
      redisMock,
      multiMock,
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

  it('enforces public ai rate limit via Redis', async () => {
    const { service, aiSearchService } = createService({
      maxRequests: 1,
      redisRequestCount: 1,
    });

    await expect(
      collect(
        service.aiAnswers({
          query: 'should be rate limited',
          workspaceId: 'workspace-1',
          requesterKey: '127.0.0.1',
        }),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    expect(aiSearchService.answerWithContext).not.toHaveBeenCalled();
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

  describe('enforceOrigin', () => {
    it('allows any origin when whitelist is empty', () => {
      const { service } = createService();
      expect(() => service.enforceOrigin('https://evil.com')).not.toThrow();
      expect(() => service.enforceOrigin(undefined)).not.toThrow();
    });

    it('blocks unlisted origins when whitelist is configured', () => {
      const { service } = createService();
      // Override the mock to return a whitelist
      (service as any).environmentService.getPublicWikiAiAllowedOrigins
        .mockReturnValue(['https://wiki.example.com']);

      expect(() => service.enforceOrigin('https://evil.com')).toThrow();
      expect(() => service.enforceOrigin(undefined)).toThrow();
      expect(() => service.enforceOrigin('https://wiki.example.com')).not.toThrow();
    });
  });
});
