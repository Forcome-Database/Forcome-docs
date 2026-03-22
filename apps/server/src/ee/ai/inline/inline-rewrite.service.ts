import { Injectable } from '@nestjs/common';

export interface InlineRewriteRequest {
  selectionSnapshot: string;
  localContext: string;
  action: string;
  taskSummaryRef?: {
    summary?: string;
    includeRawHistory?: boolean;
  } | null;
}

@Injectable()
export class InlineRewriteService {
  async rewriteSelection(request: InlineRewriteRequest) {
    return {
      candidate: request.selectionSnapshot || request.localContext,
      riskFlags: [],
      allowedActions: ['replace_selection', 'insert_below'],
    };
  }
}
