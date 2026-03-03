import { Module } from '@nestjs/common';
import { AgentGatewayController } from './agent-gateway.controller';
import { AgentGatewayService } from './agent-gateway.service';

@Module({
  controllers: [AgentGatewayController],
  providers: [AgentGatewayService],
})
export class AgentGatewayModule {}
