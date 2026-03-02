import { Module } from '@nestjs/common';
import { DingTalkController } from './dingtalk.controller';
import { DingTalkService } from './dingtalk.service';
import { DingTalkApiService } from './dingtalk-api.service';
import { TokenModule } from '../../core/auth/token.module';

@Module({
  imports: [TokenModule],
  controllers: [DingTalkController],
  providers: [DingTalkService, DingTalkApiService],
  exports: [DingTalkService],
})
export class DingTalkModule {}
