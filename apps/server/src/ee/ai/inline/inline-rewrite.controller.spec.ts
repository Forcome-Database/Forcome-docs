import { InlineRewriteController } from './inline-rewrite.controller';

describe('InlineRewriteController', () => {
  it('accepts the dedicated inline rewrite contract', async () => {
    const service = {
      rewriteSelection: jest.fn().mockResolvedValue({
        candidate: 'Improved selection',
        riskFlags: [],
        allowedActions: ['replace_selection', 'insert_below'],
      }),
    };

    const controller = new InlineRewriteController(service as any);

    const result = await controller.rewriteSelection({
      selectionSnapshot: 'Original paragraph',
      localContext: 'Paragraph before. Original paragraph. Paragraph after.',
      action: 'improve_writing',
      taskSummaryRef: {
        summary: 'Preserve the surrounding document structure.',
        includeRawHistory: false,
      },
    });

    expect(service.rewriteSelection).toHaveBeenCalledWith({
      selectionSnapshot: 'Original paragraph',
      localContext: 'Paragraph before. Original paragraph. Paragraph after.',
      action: 'improve_writing',
      taskSummaryRef: {
        summary: 'Preserve the surrounding document structure.',
        includeRawHistory: false,
      },
    });
    expect(result).toEqual({
      candidate: 'Improved selection',
      riskFlags: [],
      allowedActions: ['replace_selection', 'insert_below'],
    });
  });
});
