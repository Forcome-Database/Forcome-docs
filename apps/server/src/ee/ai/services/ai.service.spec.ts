jest.mock('ai', () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
}));

import { streamText } from 'ai';
import { AiService } from './ai.service';

describe('AiService.streamWithContext', () => {
  it('yields raw text chunks instead of JSON-wrapped fragments', async () => {
    (streamText as jest.Mock).mockReturnValue({
      textStream: (async function* () {
        yield '## Heading';
        yield '\n\nBody';
      })(),
    });

    const service = new AiService({
      getAiDriver: jest.fn().mockReturnValue('openai-compatible'),
      getAiCompletionModel: jest.fn().mockReturnValue('mock-model'),
      getOpenAiApiKey: jest.fn().mockReturnValue('test-key'),
      getOpenAiApiUrl: jest.fn().mockReturnValue('http://localhost:1234/v1'),
    } as any);

    const chunks: string[] = [];
    for await (const chunk of service.streamWithContext(
      'system prompt',
      'user prompt',
      [],
      [],
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['## Heading', '\n\nBody']);
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});
