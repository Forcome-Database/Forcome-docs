import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { MfaController } from './mfa.controller';
import { MfaService } from './services/mfa.service';
import { MfaRepo } from './mfa.repo';

@Module({
  imports: [TokenModule],
  controllers: [MfaController],
  providers: [MfaService, MfaRepo],
  exports: [MfaService],
})
export class MfaModule {}
