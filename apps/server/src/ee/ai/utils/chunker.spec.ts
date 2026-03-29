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

describe('chunkText with heading awareness', () => {
  it('splits at heading boundaries before char limits', () => {
    const text = '# Section A\nContent A.\n## Sub A1\nSub content.\n# Section B\nContent B.';
    const chunks = chunkText(text);
    const sectionBChunk = chunks.find(c => c.text.includes('Section B'));
    expect(sectionBChunk).toBeDefined();
    expect(sectionBChunk!.text).not.toContain('Section A');
  });

  it('falls back to char splitting for sections exceeding maxChars', () => {
    const longSection = '# Title\n' + 'Long content. '.repeat(200);
    const chunks = chunkText(longSection);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1700);
    }
  });

  it('preserves code blocks within sections', () => {
    const text = '# Code Example\n```js\nconst x = 1;\nconst y = 2;\n```\nExplanation here.';
    const chunks = chunkText(text);
    const codeChunk = chunks.find(c => c.text.includes('```'));
    expect(codeChunk!.text).toContain('const x = 1;');
  });

  it('handles document with no headings (falls back to char splitting)', () => {
    const text = 'Just plain text without any headings.\n'.repeat(100);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text).toContain('Just plain text');
  });

  it('handles heading at end of file', () => {
    const text = 'Some content.\n# Trailing Heading\n';
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles consecutive headings (empty sections)', () => {
    const text = '# First\n## Second\n### Third\nActual content here.';
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('does NOT split on headings inside code blocks', () => {
    const text = '# Real Heading\nSome text.\n```markdown\n# Fake Heading Inside Code\nNot a real section.\n```\nMore text.';
    const chunks = chunkText(text);
    const fakeSection = chunks.find(c =>
      c.text.includes('Fake Heading') && !c.text.includes('```')
    );
    expect(fakeSection).toBeUndefined();
  });
});
