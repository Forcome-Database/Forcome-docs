import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { jsonToMarkdown } from '../../collaboration/collaboration.util';
import { AiSearchService } from './services/ai-search.service';
import { AttachmentService } from '../../core/attachment/services/attachment.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';

interface InternalPageReadDto {
  pageId: string;
}

interface InternalKnowledgeSearchDto {
  workspaceId: string;
  query: string;
  spaceId?: string;
  limit?: number;
}

interface InternalUploadPageImageDto {
  pageId: string;
  filename: string;
  fileContentB64: string;
  mimeType?: string;
}

@Controller('ai/internal')
export class AiInternalController {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly aiSearchService: AiSearchService,
    private readonly attachmentService: AttachmentService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Public()
  @Post('page-read')
  async pageRead(
    @Body() dto: InternalPageReadDto,
    @Req() req: FastifyRequest,
  ) {
    this.assertInternalSecret(req);

    if (!dto.pageId) {
      throw new BadRequestException('pageId is required');
    }

    const page = await this.pageRepo.findById(dto.pageId, {
      includeContent: true,
    });
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    return {
      pageId: page.id,
      title: page.title,
      spaceId: page.spaceId,
      content: page.content
        ? jsonToMarkdown(page.content)
        : page.textContent || '',
      updatedAt: page.updatedAt,
    };
  }

  @Public()
  @Post('knowledge-search')
  async knowledgeSearch(
    @Body() dto: InternalKnowledgeSearchDto,
    @Req() req: FastifyRequest,
  ) {
    this.assertInternalSecret(req);

    if (!dto.workspaceId || !dto.query) {
      throw new BadRequestException('workspaceId and query are required');
    }

    const limit = Math.max(1, Math.min(dto.limit || 5, 10));
    const hybridResults = await this.aiSearchService.hybridSearch(
      dto.query,
      dto.workspaceId,
      limit,
      dto.spaceId ? { spaceId: dto.spaceId } : undefined,
    );
    const reranked = await this.aiSearchService.rerank(
      dto.query,
      hybridResults,
      limit,
    );

    return {
      items: reranked.map((item) => ({
        pageId: item.pageId,
        title: item.title,
        slugId: item.slugId,
        spaceSlug: item.spaceSlug,
        content: (item.chunkText || item.textContent || '').slice(0, 2000),
      })),
    };
  }

  @Public()
  @Post('upload-page-image')
  async uploadPageImage(
    @Body() dto: InternalUploadPageImageDto,
    @Req() req: FastifyRequest,
  ) {
    this.assertInternalSecret(req);

    if (!dto.pageId || !dto.filename || !dto.fileContentB64) {
      throw new BadRequestException(
        'pageId, filename, and fileContentB64 are required',
      );
    }

    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const attachment = await this.attachmentService.uploadPageImageBuffer({
      buffer: Buffer.from(dto.fileContentB64, 'base64'),
      filename: dto.filename,
      mimeType: dto.mimeType,
      userId: page.creatorId,
      pageId: page.id,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
    });

    return {
      fileId: attachment.id,
      fileName: attachment.fileName,
      url: `/api/files/${attachment.id}/${attachment.fileName}`,
    };
  }

  private assertInternalSecret(req: FastifyRequest) {
    const header = req.headers['x-internal-secret'];
    const secret = Array.isArray(header) ? header[0] : header;

    if (
      !secret ||
      secret !== this.environmentService.getAgentInternalSecret()
    ) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
