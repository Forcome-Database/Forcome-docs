import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRepo } from './api-key.repo';

@Module({
  imports: [TokenModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, ApiKeyRepo],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
