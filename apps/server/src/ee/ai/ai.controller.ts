import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';
import { AiGenerateDto, AiAnswerDto } from './dto/ai.dto';
import { FastifyReply } from 'fastify';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiSearchService: AiSearchService,
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
