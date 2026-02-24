import { Module } from '@nestjs/common';
import { LicenseModule } from './licence/license.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { MfaModule } from './mfa/mfa.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [LicenseModule, ApiKeyModule, MfaModule, AiModule],
})
export class EeModule {}
