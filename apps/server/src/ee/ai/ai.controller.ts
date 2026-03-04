import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiFileService } from './services/ai-file.service';
import { AiTemplateService } from './services/ai-template.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { Workspace, User } from '@docmost/db/types/entity.types';
import { AiGenerateDto, AiAnswerDto } from './dto/ai.dto';
import { FastifyReply, FastifyRequest } from 'fastify';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIMETYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiSearchService: AiSearchService,
    private readonly aiFileService: AiFileService,
    private readonly aiTemplateService: AiTemplateService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('generate')
  async generate(
    @Body() dto: AiGenerateDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.checkAiGenerativeEnabled(workspace);
    return this.aiService.generate(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('generate/stream')
  async generateStream(
    @Body() dto: AiGenerateDto,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    this.logger.log(`AI generate/stream called: action=${dto.action}, content length=${dto.content?.length}`);
    this.checkAiGenerativeEnabled(workspace);

    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      let chunkCount = 0;
      for await (const chunk of this.aiService.generateStream(dto)) {
        chunkCount++;
        res.raw.write(`data: ${chunk}\n\n`);
      }
      this.logger.log(`AI stream completed: ${chunkCount} chunks sent`);
      res.raw.write('data: [DONE]\n\n');
    } catch (error: any) {
      this.logger.error(`AI stream CAUGHT error: ${error?.message}`);
      res.raw.write(
        `data: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`,
      );
    } finally {
      res.raw.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('answers')
  async aiAnswers(
    @Body() dto: AiAnswerDto,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    this.checkAiSearchEnabled(workspace);

    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      for await (const chunk of this.aiSearchService.answerWithContext(
        dto.query,
        workspace.id,
      )) {
        res.raw.write(`data: ${chunk}\n\n`);
      }
      res.raw.write('data: [DONE]\n\n');
    } catch (error: any) {
      res.raw.write(
        `data: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`,
      );
    } finally {
      res.raw.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('creator/generate')
  async creatorGenerate(
    @Req() req: FastifyRequest,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
    @Res() res: FastifyReply,
  ) {
    this.checkAiGenerativeEnabled(workspace);

    // Must buffer files immediately during iteration - streams close after loop
    const bufferedFiles: { buffer: Buffer; mimetype: string; filename: string }[] = [];
    const fields: Record<string, string> = {};

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        if (bufferedFiles.length < 5) {
          if (!ALLOWED_MIMETYPES.has(part.mimetype)) {
            this.logger.warn(`Rejected file upload: unsupported type ${part.mimetype}`);
            continue;
          }
          const buffer = await part.toBuffer();
          if (buffer.length > MAX_FILE_SIZE) {
            throw new PayloadTooLargeException(
              `File "${part.filename}" exceeds the 20MB size limit`,
            );
          }
          bufferedFiles.push({
            buffer,
            mimetype: part.mimetype,
            filename: part.filename,
          });
        }
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }

    const { prompt, template, insertMode, existingContentSummary, pageTitle, history: historyRaw } =
      fields;
    const confirmedOutline = fields.confirmedOutline || '';

    if (!prompt) {
      res.status(400).send({ message: 'prompt is required' });
      return;
    }

    // Parse conversation history (max 10 recent messages)
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (historyRaw) {
      try {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed)) {
          history = parsed
            .filter((m: any) => m.role && m.content && typeof m.content === 'string')
            .map((m: any) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content.slice(0, 10000),
            }))
            .slice(-10);
        }
      } catch {
        // Ignore invalid history JSON
      }
    }

    // Process uploaded files (already buffered)
    const contentParts = await this.aiFileService.processBufferedFiles(bufferedFiles);

    // Build system prompt with three-layer resolution (without user prompt)
    let systemPrompt = '';

    // Prepend global system prompt from workspace settings
    const globalSystemPrompt = await this.aiTemplateService.getSystemPrompt(
      workspace.id,
    );
    if (globalSystemPrompt) {
      systemPrompt += globalSystemPrompt + '\n\n';
    }

    // Resolve template through layers: user → workspace → system default
    if (template) {
      const templatePrompt = await this.aiTemplateService.getTemplatePrompt(
        template,
        workspace.id,
        user.id,
      );
      if (templatePrompt) {
        systemPrompt += templatePrompt + '\n\n';
      }
    }

    if (insertMode === 'append' && existingContentSummary) {
      systemPrompt += `Page title: ${pageTitle || '(Untitled)'}\n`;
      systemPrompt += `Existing content summary:\n${existingContentSummary}\n\n`;
      systemPrompt += 'Continue writing from where the existing content left off. Match the style, tone, and structure of the existing content.\n\n';
    }

    // Two-phase SSE: outline first, then content
    const isOutlinePhase = !confirmedOutline;

    if (isOutlinePhase) {
      systemPrompt += '\n\n重要：你现在只需要生成文档的结构化大纲，不要写正文内容。使用 ## 和 ### 标题层级，每个章节下简要说明要点（1-2句）。';
    } else {
      systemPrompt += `\n\n请严格按照以下大纲结构生成完整正文：\n${confirmedOutline}`;
    }

    // Stream response
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      let chunkCount = 0;
      let accumulatedContent = '';
      for await (const chunk of this.aiService.streamWithContext(
        systemPrompt,
        prompt,
        contentParts,
        history,
      )) {
        chunkCount++;
        if (isOutlinePhase) {
          accumulatedContent += chunk;
        }
        res.raw.write(`data: ${chunk}\n\n`);
      }
      this.logger.log(
        `AI creator stream completed: ${chunkCount} chunks sent (phase=${isOutlinePhase ? 'outline' : 'content'})`,
      );

      if (isOutlinePhase) {
        // Send await_input event so the frontend can display outline interaction UI
        const outlineEvent = JSON.stringify({
          type: 'await_input',
          phase: 'outline',
          data: { outline: accumulatedContent },
        });
        res.raw.write(`data: ${outlineEvent}\n\n`);
      }

      res.raw.write('data: [DONE]\n\n');
    } catch (error: any) {
      this.logger.error(`AI creator stream error: ${error?.message}`);
      res.raw.write(
        `data: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`,
      );
    } finally {
      res.raw.end();
    }
  }

  private checkAiGenerativeEnabled(workspace: Workspace) {
    const settings = workspace.settings as any;
    if (!settings?.ai?.generative) {
      throw new BadRequestException('AI generative feature is not enabled');
    }
  }

  private checkAiSearchEnabled(workspace: Workspace) {
    const settings = workspace.settings as any;
    if (!settings?.ai?.search) {
      throw new BadRequestException('AI search feature is not enabled');
    }
  }
}
