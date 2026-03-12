import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiInternalController } from './ai-internal.controller';
import { AiTemplateController } from './ai-template.controller';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiTemplateService } from './services/ai-template.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiFileService } from './services/ai-file.service';
import { PageModule } from '../../core/page/page.module';
import { AttachmentModule } from '../../core/attachment/attachment.module';

@Module({
  imports: [PageModule, AttachmentModule],
  controllers: [AiController, AiInternalController, AiTemplateController],
  providers: [
    AiService,
    AiSearchService,
    AiTemplateService,
    AiQueueProcessor,
    AiFileService,
  ],
  exports: [AiService, AiSearchService, AiTemplateService],
})
export class AiModule {}
