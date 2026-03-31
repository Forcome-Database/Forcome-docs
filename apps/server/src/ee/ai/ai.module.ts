import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiInternalController } from './ai-internal.controller';
import { AiTemplateController } from './ai-template.controller';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiTemplateService } from './services/ai-template.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiFileService } from './services/ai-file.service';
import { AgentGatewayService } from './agent-gateway/agent-gateway.service';
import { QueryUnderstandingService } from './services/query-understanding.service';
import { AnswerVerifierService } from './services/answer-verifier.service';
import { RetrievalQualityService } from './services/retrieval-quality.service';
import { WebExplorerService } from './services/web-explorer.service';
import { PageModule } from '../../core/page/page.module';
import { AttachmentModule } from '../../core/attachment/attachment.module';
import { TokenModule } from '../../core/auth/token.module';

@Module({
  imports: [PageModule, AttachmentModule, TokenModule],
  controllers: [
    AiController,
    AiInternalController,
    AiTemplateController,
  ],
  providers: [
    AiService,
    AiSearchService,
    AiTemplateService,
    AiQueueProcessor,
    AiFileService,
    AgentGatewayService,
    QueryUnderstandingService,
    AnswerVerifierService,
    RetrievalQualityService,
    WebExplorerService,
  ],
  exports: [AiService, AiSearchService, AiTemplateService, QueryUnderstandingService, AnswerVerifierService, RetrievalQualityService, WebExplorerService],
})
export class AiModule {}
