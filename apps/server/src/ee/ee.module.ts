import { Module } from '@nestjs/common';
import { LicenseModule } from './licence/license.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { MfaModule } from './mfa/mfa.module';
import { AiModule } from './ai/ai.module';
import { DingTalkModule } from './dingtalk/dingtalk.module';

@Module({
  imports: [LicenseModule, ApiKeyModule, MfaModule, AiModule, DingTalkModule],
})
export class EeModule {}
