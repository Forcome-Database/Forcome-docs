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
import { AiTemplateService } from '../services/ai-template.service';
import {
  type AiIntentRoute,
  type AiIntentScope,
  type AiLengthPolicy,
  type AiSourcePolicy,
  resolveAiDocumentStrategy,
} from '../document-strategy';
import { deriveEvidencePreflight } from '../evidence-preflight';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 5;

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

function parseBooleanField(value?: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === 'true';
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
          throw new PayloadTooLargeException(`File ${part.filename} exceeds 20MB`);
        }
        bufferedFiles.push({ buffer, mimetype: part.mimetype, filename: part.filename });
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }

    const files = bufferedFiles.map((file) => ({
      filename: file.filename,
      mimetype: file.mimetype,
      content_b64: file.buffer.toString('base64'),
    }));

    const history = fields.history ? JSON.parse(fields.history) : [];
    const evidencePreflight = deriveEvidencePreflight({
      prompt: fields.prompt || '',
      files: files.map((file) => ({
        filename: file.filename,
        mimetype: file.mimetype,
      })),
      pageContext: {
        pageId: fields.pageId || undefined,
        pageTitle: fields.pageTitle || undefined,
        pageContent: fields.pageContent || undefined,
      },
    });

    const globalSystemPrompt = await this.aiTemplateService.getSystemPrompt(
      workspace.id,
    );
    const intentRoute = (fields.intentRoute || 'document_create') as AiIntentRoute;
    const scope = (fields.scope || 'blank_page') as AiIntentScope;
    const sourcePolicy = (fields.sourcePolicy || 'create_new') as AiSourcePolicy;
    const lengthPolicy = (fields.lengthPolicy || 'preserve') as AiLengthPolicy;
    const prioritizeUserInstructions =
      parseBooleanField(fields.prioritizeUserInstructions) ?? true;
    const templatePrompt = fields.templateId
      ? await this.aiTemplateService.getTemplatePrompt(
          fields.templateId,
          workspace.id,
          user.id,
        )
      : null;
    const documentStrategy = resolveAiDocumentStrategy(fields.templateId, {
      intentRoute,
      scope,
      sourcePolicy,
      lengthPolicy,
      prioritizeUserInstructions,
    });

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
      system_prompt: globalSystemPrompt || null,
      template_prompt: templatePrompt,
      document_strategy: documentStrategy,
      intent_route: intentRoute,
      scope,
      source_policy: sourcePolicy,
      length_policy: lengthPolicy,
      prioritize_user_instructions: prioritizeUserInstructions,
      conversation_history: history,
      evidence_items: evidencePreflight.requiredEvidence,
      workspace_id: workspace.id,
      config: {
        insert_mode: fields.insertMode || 'create',
        max_iterations: 3,
      },
    };

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
          writeSseHeaders(res);
          res.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Agent returned ${proxyRes.statusCode}` })}\n\n`);
          res.raw.end();
          return;
        }

        const taskIdHeader = Array.isArray(proxyRes.headers['x-task-id'])
          ? proxyRes.headers['x-task-id'][0]
          : proxyRes.headers['x-task-id'];
        writeSseHeaders(res, taskIdHeader);

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
      writeSseHeaders(res);
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Agent service unavailable' })}\n\n`);
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
    const postData = JSON.stringify({
      thread_id: dto.threadId,
      resume_value: dto.resumeValue,
    });

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
          writeSseHeaders(res);
          res.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Agent resume failed: ${proxyRes.statusCode}` })}\n\n`);
          res.raw.end();
          return;
        }

        const taskIdHeader = Array.isArray(proxyRes.headers['x-task-id'])
          ? proxyRes.headers['x-task-id'][0]
          : proxyRes.headers['x-task-id'];
        writeSseHeaders(res, taskIdHeader);

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
      writeSseHeaders(res);
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Agent service unavailable' })}\n\n`);
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
