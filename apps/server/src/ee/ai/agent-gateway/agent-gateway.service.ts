import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  private static readonly SESSION_OWNER_PREFIX = 'agent_session_owner:';
  private static readonly SESSION_OWNER_TTL = 86400; // 24 hours

  private static readonly CONCURRENT_PREFIX = 'agent_concurrent:';
  private static readonly MAX_CONCURRENT_TASKS = 3;
  private static readonly CONCURRENT_TTL = 1800; // 30 min safety net

  private readonly redis: Redis;

  constructor(
    private environmentService: EnvironmentService,
    private readonly redisService: RedisService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  async acquireTaskSlot(userId: string): Promise<boolean> {
    const key = `${AgentGatewayService.CONCURRENT_PREFIX}${userId}`;
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, AgentGatewayService.CONCURRENT_TTL);
    }
    if (current > AgentGatewayService.MAX_CONCURRENT_TASKS) {
      await this.redis.decr(key);
      return false;
    }
    return true;
  }

  async releaseTaskSlot(userId: string): Promise<void> {
    const key = `${AgentGatewayService.CONCURRENT_PREFIX}${userId}`;
    const val = await this.redis.decr(key);
    if (val <= 0) {
      await this.redis.del(key);
    }
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
    let data: { userId: string; workspaceId: string };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ForbiddenException('Invalid session data');
    }
    if (data.userId !== userId) {
      throw new ForbiddenException('You do not own this session');
    }
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

  buildV2RunPayload(params: {
    prompt: string;
    pageId?: string;
    threadId?: string;
    workspaceId: string;
    userId: string;
    files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
    pageContent?: string;
    editMode?: string;
    selectedText?: string;
    contextBefore?: string;
    contextAfter?: string;
    documentOutline?: string;
  }): Record<string, unknown> {
    return {
      prompt: params.prompt,
      page_id: params.pageId || undefined,
      thread_id: params.threadId || undefined,
      workspace_id: params.workspaceId,
      user_id: params.userId,
      files: params.files || [],
      page_content: params.pageContent || "",
      edit_mode: params.editMode || undefined,
      selected_text: params.selectedText || undefined,
      context_before: params.contextBefore || undefined,
      context_after: params.contextAfter || undefined,
      document_outline: params.documentOutline || undefined,
    };
  }
}
