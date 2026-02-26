import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiFileService } from './services/ai-file.service';

@Module({
  controllers: [AiController],
  providers: [AiService, AiSearchService, AiQueueProcessor, AiFileService],
  exports: [AiService, AiSearchService],
})
export class AiModule {}
