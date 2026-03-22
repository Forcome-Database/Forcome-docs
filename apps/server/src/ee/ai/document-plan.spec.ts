import { normalizeAiDocumentPlan } from './document-plan';
import { resolveAiDocumentStrategy } from './document-strategy';
import {
  createDefaultDocumentTaskApplyPayload,
  createDefaultDocumentTaskDiffSet,
  createDefaultDocumentTaskRollbackPayload,
} from './document-tasks/document-task.types';

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

  it('exposes mixed-granularity diff metadata for document-task review', () => {
    const diffSet = createDefaultDocumentTaskDiffSet();

    expect(diffSet).toEqual([
      {
        diffId: 'diff-1',
        blockId: 'block-1',
        granularity: 'block',
        textDiff: {
          granularity: 'text',
          format: 'line',
        },
      },
    ]);
  });

  it('exposes explicit apply and rollback payload shapes', () => {
    expect(createDefaultDocumentTaskApplyPayload()).toEqual({
      taskId: 'task-1',
      acceptedDiffIds: ['diff-1'],
      createRollbackSnapshot: true,
    });

    expect(createDefaultDocumentTaskRollbackPayload()).toEqual({
      taskId: 'task-1',
      rollbackRef: 'rollback-1',
    });
  });
});
