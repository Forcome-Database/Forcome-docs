import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as http from 'http';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { AgentGatewayService } from './agent-gateway.service';
import { AgentStopDto } from './dto/agent-stop.dto';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiTemplateService } from '../services/ai-template.service';

type MultipartLikePart =
  | {
      type: 'file';
      mimetype: string;
      filename: string;
      toBuffer: () => Promise<Buffer>;
    }
  | {
      type: 'field';
      fieldname: string;
      value: unknown;
    };

type AgentRunFields = {
  prompt?: string;
  pageId?: string;
  templateId?: string;
  insertMode?: string;
  pageTitle?: string;
  pageContent?: string;
  selectedText?: string;
  intentRoute?: string;
  threadId?: string;
  conversationHistory?: unknown;
  operation?: string;
  documentTask?: unknown;
};

type LegacyAgentRunBody = {
  user_message?: unknown;
  thread_id?: unknown;
  workspace_id?: unknown;
  page_id?: unknown;
  page_title?: unknown;
  page_content?: unknown;
  selected_text?: unknown;
  intent_route?: unknown;
  insert_mode?: unknown;
  files?: unknown;
  template_id?: unknown;
  system_prompt?: unknown;
  template_prompt?: unknown;
  conversation_history?: unknown;
  operation?: unknown;
  document_task?: unknown;
};

function isMultipartContentType(req: FastifyRequest): boolean {
  const contentType = req.headers?.['content-type'];
  if (Array.isArray(contentType)) {
    return contentType.some((value) => value.includes('multipart/form-data'));
  }

  return typeof contentType === 'string' && contentType.includes('multipart/form-data');
}

function isLegacyAgentRunBody(value: unknown): value is LegacyAgentRunBody {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const body = value as Record<string, unknown>;
  return (
    'user_message' in body ||
    'document_task' in body ||
    'thread_id' in body ||
    'intent_route' in body
  );
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function writeSseHeaders(res: FastifyReply, taskId?: string) {
  if (res.raw.headersSent) {
    return;
  }

  res.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...(taskId ? { 'X-Task-Id': taskId } : {}),
  });
  res.raw.flushHeaders?.();
}

function writeJsonProxyError(res: FastifyReply, statusCode: number, payload: Record<string, unknown>) {
  if (res.raw.headersSent) {
    res.raw.end();
    return;
  }

  res.raw.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.raw.end(JSON.stringify(payload));
}

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentGatewayController {
  private readonly logger = new Logger(AgentGatewayController.name);

  constructor(
    private agentGatewayService: AgentGatewayService,
    private environmentService: EnvironmentService,
    private aiTemplateService: AiTemplateService,
  ) {}

  private proxyAgentStream(
    res: FastifyReply,
    options: http.RequestOptions,
    payload: string,
    logContext: string,
    onChunk?: (chunk: Buffer) => void,
  ): Promise<void> {
    res.hijack();

    return new Promise<void>((resolve) => {
      const proxyReq = http.request({ ...options, timeout: 660000 }, (proxyRes) => {
        const taskIdHeader = Array.isArray(proxyRes.headers['x-task-id'])
          ? proxyRes.headers['x-task-id'][0]
          : proxyRes.headers['x-task-id'];
        writeSseHeaders(res, taskIdHeader);

        proxyRes.on('data', (chunk: Buffer) => {
          res.raw.write(chunk);
          if (onChunk) {
            try {
              onChunk(chunk);
            } catch {
              // Ignore callback errors to avoid breaking the stream
            }
          }
        });
        proxyRes.on('end', () => {
          res.raw.end();
          resolve();
        });
        proxyRes.on('error', (err) => {
          this.logger.error(`${logContext}: ${err.message}`);
          if (!res.raw.headersSent) {
            writeJsonProxyError(res, 502, { error: 'Agent service unavailable' });
          } else {
            res.raw.end();
          }
          resolve();
        });
      });

      proxyReq.on('timeout', () => {
        this.logger.warn(`${logContext}: proxy request timed out after 660s`);
        proxyReq.destroy();
      });

      proxyReq.on('error', (err) => {
        this.logger.error(`${logContext}: ${err.message}`);
        if (!res.raw.headersSent) {
          writeJsonProxyError(res, 502, { error: 'Agent service unavailable' });
        } else {
          res.raw.end();
        }
        resolve();
      });

      proxyReq.write(payload);
      proxyReq.end();
    });
  }

  private async readRunRequest(req: FastifyRequest): Promise<{
    fields: AgentRunFields;
    files: Array<{ filename: string; mimetype: string; content_b64: string }>;
  }> {
    const multipartReq = req as FastifyRequest & {
      parts?: () => AsyncIterable<MultipartLikePart>;
    };

    if (typeof multipartReq.parts === 'function' && isMultipartContentType(req)) {
      const fields: Record<string, unknown> = {};
      const files: Array<{ filename: string; mimetype: string; content_b64: string }> = [];

      for await (const part of multipartReq.parts()) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          files.push({
            filename: part.filename,
            mimetype: part.mimetype,
            content_b64: buffer.toString('base64'),
          });
          continue;
        }

        fields[part.fieldname] = part.value;
      }

      return {
        fields: {
          prompt: typeof fields.prompt === 'string' ? fields.prompt : undefined,
          pageId: typeof fields.pageId === 'string' ? fields.pageId : undefined,
          templateId: typeof fields.templateId === 'string' ? fields.templateId : undefined,
          insertMode: typeof fields.insertMode === 'string' ? fields.insertMode : undefined,
          pageTitle: typeof fields.pageTitle === 'string' ? fields.pageTitle : undefined,
          pageContent: typeof fields.pageContent === 'string' ? fields.pageContent : undefined,
          selectedText: typeof fields.selectedText === 'string' ? fields.selectedText : undefined,
          intentRoute: typeof fields.intentRoute === 'string' ? fields.intentRoute : undefined,
          threadId: typeof fields.threadId === 'string' ? fields.threadId : undefined,
          operation: typeof fields.operation === 'string' ? fields.operation : undefined,
          documentTask: parseJsonField(fields.documentTask),
          conversationHistory:
            typeof fields.conversationHistory === 'string'
              ? JSON.parse(fields.conversationHistory)
              : fields.conversationHistory,
        },
        files,
      };
    }

    const body = (req.body as AgentRunFields | undefined) ?? {};
    return {
      fields: {
        ...body,
        documentTask: parseJsonField(body.documentTask),
      },
      files: [],
    };
  }

  @Post('run')
  async runAgent(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @AuthUser() user: any,
    @AuthWorkspace() workspace: any,
  ) {
    // Per-user concurrent task limit
    const allowed = await this.agentGatewayService.acquireTaskSlot(user.id);
    if (!allowed) {
      throw new HttpException(
        'Too many concurrent AI tasks. Maximum 3 allowed.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const { fields, files } = await this.readRunRequest(req);
      const legacyBody = isLegacyAgentRunBody(req.body) ? req.body : null;

      const agentUrl = this.environmentService.getAgentServiceUrl();
      if (!agentUrl) {
        res.status(503).send({ error: 'Agent service not configured' });
        return;
      }

      // Resolve template prompt if provided
      let templatePrompt: string | undefined;
      const requestedTemplateId =
        fields.templateId ||
        (typeof legacyBody?.template_id === 'string' ? legacyBody.template_id : undefined);
      if (requestedTemplateId) {
        const prompt = await this.aiTemplateService.getTemplatePrompt(
          requestedTemplateId,
          workspace.id,
          user.id,
        );
        templatePrompt = prompt || undefined;
      }

      // Get workspace system prompt
      const wsSettings = workspace.settings?.ai;
      const systemPrompt: string | undefined = wsSettings?.systemPrompt || undefined;

      const payload = JSON.stringify(
        legacyBody
          ? {
              ...legacyBody,
              workspace_id:
                typeof legacyBody.workspace_id === 'string'
                  ? legacyBody.workspace_id
                  : workspace.id,
              ...(systemPrompt && typeof legacyBody.system_prompt !== 'string'
                ? { system_prompt: systemPrompt }
                : {}),
              ...(templatePrompt && typeof legacyBody.template_prompt !== 'string'
                ? { template_prompt: templatePrompt }
                : {}),
            }
          : this.agentGatewayService.buildLegacyRunPayload({
              prompt: fields.prompt || '',
              threadId: fields.threadId,
              workspaceId: workspace.id,
              pageId: fields.pageId,
              pageTitle: fields.pageTitle,
              pageContent: fields.pageContent,
              selectedText: fields.selectedText,
              intentRoute: fields.intentRoute || 'document_create',
              insertMode: fields.insertMode || 'create',
              files,
              templateId: fields.templateId,
              systemPrompt,
              templatePrompt,
              conversationHistory: Array.isArray(fields.conversationHistory)
                ? fields.conversationHistory
                : [],
              operation: fields.operation,
              documentTask:
                fields.documentTask && typeof fields.documentTask === 'object'
                  ? (fields.documentTask as Record<string, unknown>)
                  : null,
            }),
      );

      const url = new URL('/agent/run', agentUrl);
      const secret = this.environmentService.getAgentInternalSecret();

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret || '',
        },
      };

      await this.proxyAgentStream(res, options, payload, 'Agent proxy error', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        // SSE data lines start with "data: "
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === 'session' && parsed.session_id) {
              this.agentGatewayService
                .registerSessionOwner(parsed.session_id, user.id, workspace.id)
                .catch((err) =>
                  this.logger.warn(`Failed to register session owner: ${err.message}`),
                );
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      });
    } finally {
      await this.agentGatewayService.releaseTaskSlot(user.id).catch((err) =>
        this.logger.warn(`Failed to release task slot: ${err.message}`),
      );
    }
  }

  @Post('resume')
  async resumeAgent(
    @Body() body: any,
    @Res() res: FastifyReply,
    @AuthUser() user: any,
  ) {
    const sessionId = body.sessionId || body.session_id;
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    await this.agentGatewayService.validateSessionOwner(sessionId, user.id);

    const agentUrl = this.environmentService.getAgentServiceUrl();
    if (!agentUrl) {
      res.status(503).send({ error: 'Agent service not configured' });
      return;
    }

    const url = new URL('/agent/resume', agentUrl);
    const secret = this.environmentService.getAgentInternalSecret();

    const payload = JSON.stringify({
      thread_id: body.sessionId ?? body.threadId,
      resume_value: body.resumeValue,
    });

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret || '',
      },
    };

    await this.proxyAgentStream(res, options, payload, 'Agent resume proxy error');
  }

  @Get('session/:sessionId')
  async getSessionSnapshot(
    @Param('sessionId') sessionId: string,
    @Res() res: FastifyReply,
    @AuthUser() user: any,
  ) {
    await this.agentGatewayService.validateSessionOwner(sessionId, user.id);

    const agentUrl = this.environmentService.getAgentServiceUrl();
    if (!agentUrl) {
      res.status(503).send({ error: 'Agent service not configured' });
      return;
    }

    const url = new URL(`/agent/session/${sessionId}`, agentUrl);
    const secret = this.environmentService.getAgentInternalSecret();

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        'X-Internal-Secret': secret || '',
      },
    };

    await new Promise<void>((resolve) => {
      const proxyReq = http.request(options, (proxyRes) => {
        let body = '';

        proxyRes.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });

        proxyRes.on('end', () => {
          const statusCode = proxyRes.statusCode ?? 200;
          try {
            res.status(statusCode).send(body ? JSON.parse(body) : {});
          } catch (err: any) {
            this.logger.error(`Agent session snapshot proxy parse error: ${err.message}`);
            res.status(502).send({ error: 'Invalid agent session response' });
          }
          resolve();
        });
      });

      proxyReq.on('error', (err) => {
        this.logger.error(`Agent session snapshot proxy error: ${err.message}`);
        res.status(502).send({ error: 'Agent service unavailable' });
        resolve();
      });

      proxyReq.end();
    });
  }

  @Post('stop')
  async stopAgent(@Body() dto: AgentStopDto, @AuthUser() user: any) {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    await this.agentGatewayService.validateSessionOwner(dto.sessionId, user.id);
    return this.agentGatewayService.stopAgent(dto.taskId);
  }

  @Post('tools')
  async getTools() {
    return this.agentGatewayService.getTools();
  }
}
