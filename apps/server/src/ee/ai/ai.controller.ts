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
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AiGenerateDto, AiAnswerDto } from './dto/ai.dto';
import { FastifyReply } from 'fastify';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiSearchService: AiSearchService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly resourcePermRepo: ResourcePermissionRepo,
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
        res.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
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
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    this.checkAiSearchEnabled(workspace);

    // Build user-scoped retrieval scope: collect denied resources across user's spaces
    const excludedPageIds: string[] = [];
    const excludedDirectoryIds: string[] = [];

    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    await Promise.all(
      userSpaceIds.map(async (spaceId) => {
        const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(user.id, spaceId);
        const spaceRole = findHighestUserSpaceRole(userSpaceRoles);
        if (!spaceRole || spaceRole === 'none') return;

        const overrides = await this.resourcePermRepo.getUserOverridesInSpace(
          user.id, spaceId, workspace.id,
        );
        for (const o of overrides) {
          if (o.role !== 'none') continue;
          if (o.resourceType === 'page') excludedPageIds.push(o.resourceId);
          if (o.resourceType === 'directory') excludedDirectoryIds.push(o.resourceId);
        }
      }),
    );

    const scope = (excludedPageIds.length > 0 || excludedDirectoryIds.length > 0)
      ? {
          ...(excludedPageIds.length > 0 && { excludedPageIds }),
          ...(excludedDirectoryIds.length > 0 && { excludedDirectoryIds }),
        }
      : undefined;

    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      for await (const chunk of this.aiSearchService.answerWithContext({
        query: dto.query,
        workspaceId: workspace.id,
        scope,
      })) {
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
