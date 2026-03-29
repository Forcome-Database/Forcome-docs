import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiInternalController } from './ai-internal.controller';
import { AiTemplateController } from './ai-template.controller';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiTemplateService } from './services/ai-template.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiFileService } from './services/ai-file.service';
import { DocumentTasksController } from './document-tasks/document-tasks.controller';
import { DocumentTasksService } from './document-tasks/document-tasks.service';
import { AgentGatewayService } from './agent-gateway/agent-gateway.service';
import { InlineRewriteController } from './inline/inline-rewrite.controller';
import { InlineRewriteService } from './inline/inline-rewrite.service';
import { QueryUnderstandingService } from './services/query-understanding.service';
import { AnswerVerifierService } from './services/answer-verifier.service';
import { RetrievalQualityService } from './services/retrieval-quality.service';
import { PageModule } from '../../core/page/page.module';
import { AttachmentModule } from '../../core/attachment/attachment.module';
import { TokenModule } from '../../core/auth/token.module';

@Module({
  imports: [PageModule, AttachmentModule, TokenModule],
  controllers: [
    AiController,
    AiInternalController,
    AiTemplateController,
    DocumentTasksController,
    InlineRewriteController,
  ],
  providers: [
    AiService,
    AiSearchService,
    AiTemplateService,
    AiQueueProcessor,
    AiFileService,
    DocumentTasksService,
    AgentGatewayService,
    InlineRewriteService,
    QueryUnderstandingService,
    AnswerVerifierService,
    RetrievalQualityService,
  ],
  exports: [AiService, AiSearchService, AiTemplateService, QueryUnderstandingService, AnswerVerifierService, RetrievalQualityService],
})
export class AiModule {}
