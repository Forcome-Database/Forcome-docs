import { chunkText } from './chunker';

describe('chunkText', () => {
  it('produces chunks whose offsets align with the input text', () => {
    const text = 'Hello world. This is a test document with enough content to produce multiple chunks.'.repeat(30);
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      const reconstructed = text.slice(chunk.chunkStart, chunk.chunkStart + chunk.chunkLength);
      expect(reconstructed).toBe(chunk.text);
    }
  });

  it('preserves code blocks as unsplittable segments', () => {
    const text = 'Before.\n```js\nconst x = 1;\n```\nAfter content here.';
    const chunks = chunkText(text);
    const codeChunk = chunks.find(c => c.text.includes('```'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.text).toContain('const x = 1;');
  });
});
