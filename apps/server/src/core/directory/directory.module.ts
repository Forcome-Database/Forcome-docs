import { Module } from '@nestjs/common';
import { DirectoryService } from './directory.service';
import { DirectoryController } from './directory.controller';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '../../integrations/queue/constants';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.AI_QUEUE })],
  controllers: [DirectoryController],
  providers: [DirectoryService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
