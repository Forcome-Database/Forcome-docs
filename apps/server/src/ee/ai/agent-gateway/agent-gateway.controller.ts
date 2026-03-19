import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  Logger,
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
};

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
  ): Promise<void> {
    res.hijack();

    return new Promise<void>((resolve) => {
      const proxyReq = http.request(options, (proxyRes) => {
        const taskIdHeader = Array.isArray(proxyRes.headers['x-task-id'])
          ? proxyRes.headers['x-task-id'][0]
          : proxyRes.headers['x-task-id'];
        writeSseHeaders(res, taskIdHeader);

        proxyRes.on('data', (chunk: Buffer) => {
          res.raw.write(chunk);
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

    if (typeof multipartReq.parts === 'function') {
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
          conversationHistory:
            typeof fields.conversationHistory === 'string'
              ? JSON.parse(fields.conversationHistory)
              : fields.conversationHistory,
        },
        files,
      };
    }

    const body = (req.body as AgentRunFields | undefined) ?? {};
    return { fields: body, files: [] };
  }

  @Post('run')
  async runAgent(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @AuthUser() user: any,
    @AuthWorkspace() workspace: any,
  ) {
    const { fields, files } = await this.readRunRequest(req);

    const agentUrl = this.environmentService.getAgentServiceUrl();
    if (!agentUrl) {
      res.status(503).send({ error: 'Agent service not configured' });
      return;
    }

    // Resolve template prompt if provided
    let templatePrompt: string | undefined;
    if (fields.templateId) {
      const prompt = await this.aiTemplateService.getTemplatePrompt(
        fields.templateId,
        workspace.id,
        user.id,
      );
      templatePrompt = prompt || undefined;
    }

    // Get workspace system prompt
    const wsSettings = workspace.settings?.ai;
    const systemPrompt: string | undefined = wsSettings?.systemPrompt || undefined;

    const payload = JSON.stringify({
      user_message: fields.prompt || '',
      thread_id: fields.threadId || undefined,
      workspace_id: workspace.id,
      page_id: fields.pageId || undefined,
      page_title: fields.pageTitle || undefined,
      page_content: fields.pageContent || undefined,
      selected_text: fields.selectedText || undefined,
      intent_route: fields.intentRoute || 'document_create',
      insert_mode: fields.insertMode || 'create',
      files,
      template_id: fields.templateId || undefined,
      system_prompt: systemPrompt,
      template_prompt: templatePrompt,
      conversation_history: Array.isArray(fields.conversationHistory)
        ? fields.conversationHistory
        : [],
    });

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

    await this.proxyAgentStream(res, options, payload, 'Agent proxy error');
  }

  @Post('resume')
  async resumeAgent(@Body() body: any, @Res() res: FastifyReply) {
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
  ) {
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
  async stopAgent(@Body() dto: AgentStopDto) {
    return this.agentGatewayService.stopAgent(dto.taskId);
  }

  @Post('tools')
  async getTools() {
    return this.agentGatewayService.getTools();
  }
}
