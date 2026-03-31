import {
  BadRequestException,
  Controller,
  Post,
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

  @Post('v2/run')
  async agentV2Run(
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
      const agentUrl = this.environmentService.getAgentServiceUrl();
      if (!agentUrl) {
        res.status(503).send({ error: 'Agent service not configured' });
        return;
      }

      // Parse JSON body (no multipart needed for v2)
      const body = (req.body as Record<string, unknown> | undefined) ?? {};

      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const pageId = typeof body.pageId === 'string' ? body.pageId : undefined;
      const threadId = typeof body.threadId === 'string' ? body.threadId : undefined;
      const pageContent = typeof body.pageContent === 'string' ? body.pageContent : undefined;
      const editMode = typeof body.editMode === 'string' ? body.editMode : undefined;
      const selectedText = typeof body.selectedText === 'string' ? body.selectedText : undefined;
      const contextBefore = typeof body.contextBefore === 'string' ? body.contextBefore : undefined;
      const contextAfter = typeof body.contextAfter === 'string' ? body.contextAfter : undefined;
      const documentOutline = typeof body.documentOutline === 'string' ? body.documentOutline : undefined;
      const rawFiles = Array.isArray(body.files) ? body.files : [];
      const files = rawFiles.filter(
        (f): f is { content_b64: string; filename: string; mimetype: string } =>
          f !== null &&
          typeof f === 'object' &&
          typeof (f as Record<string, unknown>).content_b64 === 'string' &&
          typeof (f as Record<string, unknown>).filename === 'string' &&
          typeof (f as Record<string, unknown>).mimetype === 'string',
      );

      const payload = JSON.stringify(
        this.agentGatewayService.buildV2RunPayload({
          prompt,
          pageId,
          threadId,
          workspaceId: workspace.id,
          userId: user.id,
          files,
          pageContent,
          editMode,
          selectedText,
          contextBefore,
          contextAfter,
          documentOutline,
        }),
      );

      const url = new URL('/agent/v2/run', agentUrl);
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

      await this.proxyAgentStream(res, options, payload, 'Agent v2 proxy error', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
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

  @Post('stop')
  async stopAgent(@Body() dto: AgentStopDto, @AuthUser() user: any) {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    await this.agentGatewayService.validateSessionOwner(dto.sessionId, user.id);
    return this.agentGatewayService.stopAgent(dto.taskId);
  }
}
