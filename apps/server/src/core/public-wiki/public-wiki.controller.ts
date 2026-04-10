import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PublicWikiService } from './public-wiki.service';
import {
  PublicSidebarDto,
  PublicDirectoriesDto,
  PublicPageDto,
  PublicSearchDto,
  PublicAiAnswerDto,
} from './dto/public-wiki.dto';
import { FastifyReply, FastifyRequest } from 'fastify';

@UseGuards(JwtAuthGuard)
@Controller('public-wiki')
export class PublicWikiController {
  private readonly logger = new Logger(PublicWikiController.name);

  constructor(private readonly publicWikiService: PublicWikiService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('settings')
  async getSettings(@AuthWorkspace() workspace: Workspace) {
    return this.publicWikiService.getSettings(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('spaces')
  async getSpaces(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.getSpaces(user, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('directories')
  async getDirectories(
    @AuthUser() user: User,
    @Body() dto: PublicDirectoriesDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.getDirectories(user, dto.spaceSlug, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('sidebar')
  async getSidebar(
    @AuthUser() user: User,
    @Body() dto: PublicSidebarDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.getSidebarTree(user, dto.spaceSlug, workspace.id, dto.directoryId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('page')
  async getPage(
    @AuthUser() user: User,
    @Body() dto: PublicPageDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.getPage(
      user,
      { pageId: dto.pageId, slugId: dto.slugId, format: dto.format },
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('search')
  async search(
    @AuthUser() user: User,
    @Body() dto: PublicSearchDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.searchPages(
      user,
      dto.query,
      workspace.id,
      dto.spaceSlug,
      dto.limit,
    );
  }

  @Post('ai/answers')
  async aiAnswers(
    @AuthUser() user: User,
    @Body() dto: PublicAiAnswerDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    // SSE bypasses Fastify response pipeline, so CORS headers must be set manually.
    // (Fastify CORS plugin only adds headers to responses going through its pipeline,
    // but res.raw.writeHead() writes directly to the Node.js socket.)
    const origin = req.headers.origin as string | undefined;
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    });

    try {
      for await (const chunk of this.publicWikiService.aiAnswers({
        query: dto.query,
        workspaceId: workspace.id,
        pageSlugId: dto.pageSlugId,
        images: dto.images,
        history: dto.history,
        userId: user.id,
        sessionId: dto.sessionId,
        deepResearch: dto.deepResearch,
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
}
