import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  constructor(private environmentService: EnvironmentService) {}

  async forwardToAgent(path: string, body: Record<string, any>): Promise<Response> {
    const baseUrl = this.environmentService.getAgentServiceUrl();
    const secret = this.environmentService.getAgentInternalSecret();

    const resp = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      this.logger.error(`Agent service error: ${resp.status} ${errText}`);
      throw new Error(`Agent service returned ${resp.status}`);
    }

    return resp;
  }

  async stopAgent(taskId: string): Promise<any> {
    const baseUrl = this.environmentService.getAgentServiceUrl();
    const secret = this.environmentService.getAgentInternalSecret();

    const resp = await fetch(`${baseUrl}/agent/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ task_id: taskId }),
    });

    return resp.json();
  }

  async getTools(): Promise<any> {
    const baseUrl = this.environmentService.getAgentServiceUrl();
    const resp = await fetch(`${baseUrl}/tools`);
    return resp.json();
  }
}
