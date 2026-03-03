import { Module } from '@nestjs/common';

const eeImports = [
  (() => {
    try {
      return require('./ai/ai.module').AiModule;
    } catch {
      return null;
    }
  })(),
  (() => {
    try {
      return require('./ai/agent-gateway/agent-gateway.module').AgentGatewayModule;
    } catch {
      return null;
    }
  })(),
].filter(Boolean);

@Module({
  imports: eeImports,
})
export class EeModule {}
