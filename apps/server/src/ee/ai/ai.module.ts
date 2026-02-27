import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiTemplateController } from './ai-template.controller';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiTemplateService } from './services/ai-template.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiFileService } from './services/ai-file.service';

@Module({
  controllers: [AiController, AiTemplateController],
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
