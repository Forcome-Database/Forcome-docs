import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  private static readonly SESSION_OWNER_PREFIX = 'agent_session_owner:';
  private static readonly SESSION_OWNER_TTL = 86400; // 24 hours

  private readonly redis: Redis;

  constructor(
    private environmentService: EnvironmentService,
    private readonly redisService: RedisService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  async registerSessionOwner(
    sessionId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.redis.set(
      `${AgentGatewayService.SESSION_OWNER_PREFIX}${sessionId}`,
      JSON.stringify({ userId, workspaceId }),
      'EX',
      AgentGatewayService.SESSION_OWNER_TTL,
    );
  }

  async validateSessionOwner(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const raw = await this.redis.get(
      `${AgentGatewayService.SESSION_OWNER_PREFIX}${sessionId}`,
    );
    if (!raw) {
      throw new ForbiddenException('Session not found or expired');
    }
    const data = JSON.parse(raw);
    if (data.userId !== userId) {
      throw new ForbiddenException('You do not own this session');
    }
  }

  buildLegacyRunPayload(params: {
    prompt: string;
    pageId?: string;
    pageTitle?: string;
    pageContent?: string;
    selectedText?: string;
    intentRoute?: string;
    insertMode?: string;
    threadId?: string;
    workspaceId?: string;
    templateId?: string;
    systemPrompt?: string;
    templatePrompt?: string;
    files?: Array<{ filename: string; mimetype: string; content_b64: string }>;
    conversationHistory?: unknown[];
    operation?: string;
    documentTask?: Record<string, unknown> | null;
    payload?: Record<string, unknown>;
  }): Record<string, unknown> {
    return {
      user_message: params.prompt || '',
      thread_id: params.threadId || undefined,
      workspace_id: params.workspaceId || '',
      page_id: params.pageId || undefined,
      page_title: params.pageTitle || undefined,
      page_content: params.pageContent || undefined,
      selected_text: params.selectedText || undefined,
      intent_route: params.intentRoute || 'document_create',
      insert_mode: params.insertMode || 'create',
      files: params.files || [],
      template_id: params.templateId || undefined,
      system_prompt: params.systemPrompt || undefined,
      template_prompt: params.templatePrompt || undefined,
      conversation_history: Array.isArray(params.conversationHistory)
        ? params.conversationHistory
        : [],
      ...(params.operation ? { operation: params.operation } : {}),
      ...(params.documentTask ? { document_task: params.documentTask } : {}),
      ...(params.payload ? { payload: params.payload } : {}),
    };
  }

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
