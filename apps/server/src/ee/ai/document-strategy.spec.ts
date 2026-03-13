import {
  formatDocumentStrategyForPrompt,
  resolveAiDocumentStrategy,
} from './document-strategy';

describe('document strategy', () => {
  it('returns template-specific requirements', () => {
    const strategy = resolveAiDocumentStrategy('operation-manual');

    expect(strategy.docType).toBe('operations-manual');
    expect(strategy.requiredSections).toContain('steps');
    expect(strategy.optionalArtifacts).toContain('image');
  });

  it('falls back to the general strategy', () => {
    const strategy = resolveAiDocumentStrategy(null);

    expect(strategy.templateKey).toBe('general');
    expect(strategy.editorSyntaxHints.length).toBeGreaterThan(0);
  });

  it('formats the strategy into a prompt section', () => {
    const prompt = formatDocumentStrategyForPrompt(
      resolveAiDocumentStrategy('technical-doc'),
    );

    expect(prompt).toContain('Document strategy:');
    expect(prompt).toContain('Required artifacts');
    expect(prompt).toContain('code_block');
    expect(prompt).toContain('Mermaid');
  });

  it('applies request-specific routing overrides', () => {
    const strategy = resolveAiDocumentStrategy('technical-doc', {
      intentRoute: 'document_transform',
      scope: 'uploaded_document',
      sourcePolicy: 'preserve_source',
      lengthPolicy: 'compress',
      prioritizeUserInstructions: true,
    });

    expect(strategy.intentRoute).toBe('document_transform');
    expect(strategy.scope).toBe('uploaded_document');
    expect(strategy.sourcePolicy).toBe('preserve_source');
    expect(strategy.lengthPolicy).toBe('compress');
    expect(strategy.prioritizeUserInstructions).toBe(true);
  });
});
