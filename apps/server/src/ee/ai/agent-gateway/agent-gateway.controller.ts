import {
  Controller,
  Post,
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

  @Post('run')
  async runAgent(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @AuthUser() user: any,
    @AuthWorkspace() workspace: any,
  ) {
    const body = req.body as any;

    const agentUrl = this.environmentService.getAgentServiceUrl();
    if (!agentUrl) {
      res.status(503).send({ error: 'Agent service not configured' });
      return;
    }

    // Resolve template prompt if provided
    let templatePrompt: string | undefined;
    if (body.templateId) {
      const prompt = await this.aiTemplateService.getTemplatePrompt(
        body.templateId,
        workspace.id,
        user.id,
      );
      templatePrompt = prompt || undefined;
    }

    // Get workspace system prompt
    const wsSettings = workspace.settings?.ai;
    const systemPrompt: string | undefined = wsSettings?.systemPrompt || undefined;

    const payload = JSON.stringify({
      user_message: body.prompt || '',
      thread_id: body.threadId || undefined,
      workspace_id: workspace.id,
      page_id: body.pageId || undefined,
      page_title: body.pageTitle || undefined,
      page_content: body.pageContent || undefined,
      selected_text: body.selectedText || undefined,
      intent_route: body.intentRoute || 'document_create',
      insert_mode: body.insertMode || 'create',
      files: [],
      template_id: body.templateId || undefined,
      system_prompt: systemPrompt,
      template_prompt: templatePrompt,
      conversation_history: body.conversationHistory || [],
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

    writeSseHeaders(res);

    const proxyReq = http.request(options, (proxyRes) => {
      const taskIdHeader = Array.isArray(proxyRes.headers['x-task-id'])
        ? proxyRes.headers['x-task-id'][0]
        : proxyRes.headers['x-task-id'];
      if (taskIdHeader && !res.raw.headersSent) {
        res.raw.setHeader('X-Task-Id', taskIdHeader);
      }
      proxyRes.on('data', (chunk: Buffer) => {
        res.raw.write(chunk);
      });
      proxyRes.on('end', () => {
        res.raw.end();
      });
    });

    proxyReq.on('error', (err) => {
      this.logger.error(`Agent proxy error: ${err.message}`);
      if (!res.raw.headersSent) {
        res.status(502).send({ error: 'Agent service unavailable' });
      } else {
        res.raw.end();
      }
    });

    proxyReq.write(payload);
    proxyReq.end();
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
      thread_id: body.threadId,
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

    const proxyReq = http.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      proxyRes.on('end', () => {
        try {
          res.send(JSON.parse(data));
        } catch {
          res.send({ status: 'ok', raw: data });
        }
      });
    });

    proxyReq.on('error', (err) => {
      this.logger.error(`Agent resume proxy error: ${err.message}`);
      res.status(502).send({ error: 'Agent service unavailable' });
    });

    proxyReq.write(payload);
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
