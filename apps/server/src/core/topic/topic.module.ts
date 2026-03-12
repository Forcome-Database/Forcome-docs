import { Module } from '@nestjs/common';
import { TopicService } from './topic.service';
import { TopicController } from './topic.controller';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '../../integrations/queue/constants';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.AI_QUEUE })],
  controllers: [TopicController],
  providers: [TopicService],
  exports: [TopicService],
})
export class TopicModule {}
