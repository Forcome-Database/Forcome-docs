import { Injectable } from '@nestjs/common';
import { AiService } from '../services/ai.service';
import { AiAction } from '../dto/ai.dto';

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
  constructor(private readonly aiService: AiService) {}

  async rewriteSelection(request: InlineRewriteRequest) {
    const content = request.selectionSnapshot || request.localContext;
    const result = await this.aiService.generate({
      action: request.action as AiAction,
      content,
    });
    return {
      candidate: result.content,
      riskFlags: [],
      allowedActions: ['replace_selection', 'insert_below'],
    };
  }
}
