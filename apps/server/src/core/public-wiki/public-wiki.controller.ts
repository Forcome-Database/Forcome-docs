import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';
import { PublicWikiService } from './public-wiki.service';
import {
  PublicSidebarDto,
  PublicPageDto,
  PublicSearchDto,
  PublicAiAnswerDto,
} from './dto/public-wiki.dto';
import { FastifyReply } from 'fastify';

@UseGuards(JwtAuthGuard)
@Controller('public-wiki')
export class PublicWikiController {
  private readonly logger = new Logger(PublicWikiController.name);

  constructor(private readonly publicWikiService: PublicWikiService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('spaces')
  async getPublicSpaces(@AuthWorkspace() workspace: Workspace) {
    return this.publicWikiService.getPublicSpaces(workspace.id);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('sidebar')
  async getSidebar(
    @Body() dto: PublicSidebarDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.getSidebarTree(dto.spaceSlug, workspace.id);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('page')
  async getPage(
    @Body() dto: PublicPageDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.getPage(
      { pageId: dto.pageId, slugId: dto.slugId, format: dto.format },
      workspace.id,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('search')
  async search(
    @Body() dto: PublicSearchDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.publicWikiService.searchPublicPages(
      dto.query,
      workspace.id,
      dto.spaceSlug,
      dto.limit,
    );
  }

  @Public()
  @Post('ai/answers')
  async aiAnswers(
    @Body() dto: PublicAiAnswerDto,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    const origin = (res.request?.headers as any)?.origin || '*';
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    });

    try {
      for await (const chunk of this.publicWikiService.aiAnswers(
        dto.query,
        workspace.id,
        dto.pageSlugId,
        dto.history,
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
}
