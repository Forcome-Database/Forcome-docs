import { AiSearchService } from './ai-search.service';

describe('AiSearchService.rerank', () => {
  const candidates = [
    {
      pageId: 'page-1',
      title: 'First',
      slugId: 'first',
      spaceSlug: 'docs',
      textContent: 'first content',
      score: 0.9,
    },
    {
      pageId: 'page-2',
      title: 'Second',
      slugId: 'second',
      spaceSlug: 'docs',
      textContent: 'second content',
      score: 0.8,
    },
    {
      pageId: 'page-3',
      title: 'Third',
      slugId: 'third',
      spaceSlug: 'docs',
      textContent: 'third content',
      score: 0.7,
    },
  ];

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses AI_RERANK_API_KEY for dedicated rerank requests', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.5 },
        ],
      }),
    }) as any;

    const environmentService = {
      getAiRerankModel: jest.fn().mockReturnValue('rerank-model'),
      getAiRerankApiUrl: jest
        .fn()
        .mockReturnValue('http://rerank.example/v1'),
      getAiRerankApiKey: jest.fn().mockReturnValue('rerank-key'),
      getOpenAiApiUrl: jest.fn().mockReturnValue('http://openai.example/v1'),
      getOpenAiApiKey: jest.fn().mockReturnValue('openai-key'),
    } as any;

    const service = new AiSearchService({} as any, environmentService);

    const result = await service.rerank('query', candidates as any, 2);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://rerank.example/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer rerank-key',
        }),
      }),
    );
    expect(result).toEqual([candidates[1], candidates[0]]);
  });
});
