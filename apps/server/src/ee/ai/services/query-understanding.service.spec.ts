jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

import { generateText } from 'ai';
import { QueryUnderstandingService } from './query-understanding.service';

describe('QueryUnderstandingService.classifyAndRewrite', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls generateText without an artificial abort timeout and parses the response', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({
        intent: 'procedural',
        complexity: 2,
        rewrittenQuery: 'How do I deploy Docker?',
        needsClarification: false,
        isOutOfScope: false,
      }),
    });

    const service = new QueryUnderstandingService();
    const liteModel = { modelId: 'mock-lite-model' };

    const result = await service.classifyAndRewrite(
      'how do I deploy docker',
      [{ role: 'assistant', content: 'We were discussing deployment.' }],
      'Docker Guide',
      liteModel,
    );

    expect(result).toEqual({
      intent: 'procedural',
      complexity: 2,
      rewrittenQuery: 'How do I deploy Docker?',
      needsClarification: false,
      clarificationQuestion: undefined,
      isOutOfScope: false,
    });

    expect(generateText).toHaveBeenCalledTimes(1);

    const call = (generateText as jest.Mock).mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        model: liteModel,
        maxTokens: 300,
        temperature: 0,
        messages: [
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Current query: how do I deploy docker'),
          }),
        ],
      }),
    );
    expect(call).not.toHaveProperty('abortSignal');
  });
});
