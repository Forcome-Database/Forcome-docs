import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as http from 'http';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { AgentGatewayService } from './agent-gateway.service';
import { AgentStopDto } from './dto/agent-stop.dto';
import { AgentResumeDto } from './dto/agent-resume.dto';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 5;

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentGatewayController {
  private readonly logger = new Logger(AgentGatewayController.name);

  constructor(
    private agentGatewayService: AgentGatewayService,
    private environmentService: EnvironmentService,
  ) {}

  @Post('run')
  async runAgent(
    @AuthUser() user: any,
    @AuthWorkspace() workspace: any,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const parts = req.parts();
    const bufferedFiles: { buffer: Buffer; mimetype: string; filename: string }[] = [];
    const fields: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        if (bufferedFiles.length >= MAX_FILES) continue;
        const buffer = await part.toBuffer();
        if (buffer.length > MAX_FILE_SIZE) {
          throw new PayloadTooLargeException(`文件 ${part.filename} 超过 20MB 限制`);
        }
        bufferedFiles.push({ buffer, mimetype: part.mimetype, filename: part.filename });
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }

    const files = bufferedFiles.map((f) => ({
      filename: f.filename,
      mimetype: f.mimetype,
      content_b64: f.buffer.toString('base64'),
    }));

    const history = fields.history ? JSON.parse(fields.history) : [];

    const agentBody = {
      user_message: fields.prompt || '',
      files,
      page_context: {
        page_id: fields.pageId || null,
        page_title: fields.pageTitle || null,
        page_content: fields.pageContent || null,
        selected_text: fields.selectedText || null,
        selection_range: fields.selectionRange ? JSON.parse(fields.selectionRange) : null,
      },
      template_id: fields.templateId || null,
      conversation_history: history,
      workspace_id: workspace.id,
      config: {
        insert_mode: fields.insertMode || 'create',
        max_iterations: 3,
      },
    };

    // Set SSE headers immediately
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Use Node.js http.request for true chunked streaming (fetch buffers SSE)
    const agentUrl = new URL('/agent/run', this.environmentService.getAgentServiceUrl());
    const postData = JSON.stringify(agentBody);

    const proxyReq = http.request(
      {
        hostname: agentUrl.hostname,
        port: agentUrl.port,
        path: agentUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Internal-Secret': this.environmentService.getAgentInternalSecret(),
        },
      },
      (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
          res.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Agent 返回 ${proxyRes.statusCode}` })}\n\n`);
          res.raw.end();
          return;
        }
        // Pipe SSE chunks directly to client in real-time
        proxyRes.on('data', (chunk: Buffer) => {
          res.raw.write(chunk);
        });
        proxyRes.on('end', () => {
          res.raw.end();
        });
        proxyRes.on('error', (err) => {
          this.logger.error('Agent stream error', err);
          res.raw.end();
        });
      },
    );

    proxyReq.on('error', (err) => {
      this.logger.error('Agent connection error', err);
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Agent 服务不可用' })}\n\n`);
      res.raw.end();
    });

    proxyReq.write(postData);
    proxyReq.end();
  }

  @Post('resume')
  async resumeAgent(
    @Body() dto: AgentResumeDto,
    @Res() res: FastifyReply,
  ): Promise<void> {
    // Set SSE headers immediately
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Build POST data
    const postData = JSON.stringify({
      thread_id: dto.threadId,
      resume_value: dto.resumeValue,
    });

    // Use Node.js http.request for true chunked streaming (fetch buffers SSE)
    const agentUrl = new URL('/agent/resume', this.environmentService.getAgentServiceUrl());

    const proxyReq = http.request(
      {
        hostname: agentUrl.hostname,
        port: agentUrl.port,
        path: agentUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Internal-Secret': this.environmentService.getAgentInternalSecret(),
        },
      },
      (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
          res.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Agent resume failed: ${proxyRes.statusCode}` })}\n\n`);
          res.raw.end();
          return;
        }
        // Pipe SSE chunks directly to client in real-time
        proxyRes.on('data', (chunk: Buffer) => {
          res.raw.write(chunk);
        });
        proxyRes.on('end', () => {
          res.raw.end();
        });
        proxyRes.on('error', (err) => {
          this.logger.error('Agent resume stream error', err);
          res.raw.end();
        });
      },
    );

    proxyReq.on('error', (err) => {
      this.logger.error('Agent resume connection error', err);
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Agent 服务不可用' })}\n\n`);
      res.raw.end();
    });

    proxyReq.write(postData);
    proxyReq.end();
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
