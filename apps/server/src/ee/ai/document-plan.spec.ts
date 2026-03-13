import { normalizeAiDocumentPlan } from './document-plan';
import { resolveAiDocumentStrategy } from './document-strategy';

describe('document plan contract', () => {
  it('uses strategy defaults when the planner returns no sections', () => {
    const plan = normalizeAiDocumentPlan(
      {},
      resolveAiDocumentStrategy('technical-doc'),
    );

    expect(plan.doc_type).toBe('technical-documentation');
    expect(plan.required_artifacts).toEqual(['code_block']);
    expect(plan.sections.map((section) => section.title)).toEqual([
      'overview',
      'key concepts',
      'usage or workflow',
    ]);
  });

  it('normalizes evidence aliases into the shared contract values', () => {
    const plan = normalizeAiDocumentPlan({
      sections: [
        {
          title: 'Workflow',
          goal: 'Explain the workflow',
          artifacts: ['mermaid', 'unknown'],
          must_cover: ['resume flow'],
          evidence: ['search', 'knowledge_base', 'image_generation', 'vision'],
        },
      ],
    });

    expect(plan.sections).toEqual([
      {
        id: 'section-1',
        title: 'Workflow',
        goal: 'Explain the workflow',
        artifacts: ['mermaid'],
        must_cover: ['resume flow'],
        evidence: [
          'web_search',
          'knowledge_search',
          'generated_image',
          'vision',
        ],
      },
    ]);
  });
});
