import { Module } from '@nestjs/common';
import { AgentGatewayController } from './agent-gateway.controller';
import { AgentGatewayService } from './agent-gateway.service';
import { AiModule } from '../ai.module';

@Module({
  imports: [AiModule],
  controllers: [AgentGatewayController],
  providers: [AgentGatewayService],
})
export class AgentGatewayModule {}
