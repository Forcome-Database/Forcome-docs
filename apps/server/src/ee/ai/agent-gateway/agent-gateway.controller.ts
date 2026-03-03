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
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { AgentGatewayService } from './agent-gateway.service';
import { AgentStopDto } from './dto/agent-stop.dto';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 5;

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentGatewayController {
  private readonly logger = new Logger(AgentGatewayController.name);

  constructor(private agentGatewayService: AgentGatewayService) {}

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

    try {
      const agentResp = await this.agentGatewayService.forwardToAgent('/agent/run', agentBody);

      res.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const reader = agentResp.body?.getReader();
      if (!reader) {
        res.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Agent 无响应' })}\n\n`);
        res.raw.end();
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.raw.write(chunk);
      }

      res.raw.end();
    } catch (error) {
      this.logger.error('Agent run failed', error);
      if (!res.raw.headersSent) {
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: error?.message || 'Agent 服务不可用' })}\n\n`);
      res.raw.end();
    }
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
