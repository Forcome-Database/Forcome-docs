import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportPageDto, ExportSpaceDto } from './dto/export-dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import { ResourceAbilityFactory } from '../../core/casl/abilities/resource-ability.factory';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import { FastifyReply } from 'fastify';
import { sanitize } from 'sanitize-filename-ts';
import { getExportExtension } from './utils';
import { getMimeType } from '../../common/helpers';
import * as path from 'path';

@Controller()
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly resourceAbility: ResourceAbilityFactory,
    private readonly resourcePermRepo: ResourcePermissionRepo,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('pages/export')
  async exportPage(
    @Body() dto: ExportPageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    const page = await this.pageRepo.findById(dto.pageId, {
      includeContent: true,
    });

    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.resourceAbility.createForUser(
      user, 'page', page.id,
      { directoryId: page.directoryId, spaceId: page.spaceId },
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    // Build denied set for child page filtering
    let excludedPageIds: Set<string> | undefined;
    if (dto.includeChildren) {
      const overrides = await this.resourcePermRepo.getUserOverridesInSpace(
        user.id, page.spaceId, workspace.id,
      );
      const deniedPageIds = new Set<string>();
      const deniedDirIds = new Set<string>();
      for (const o of overrides) {
        if (o.role !== 'none') continue;
        if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
        if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
      }
      if (deniedPageIds.size > 0 || deniedDirIds.size > 0) {
        excludedPageIds = new Set(deniedPageIds);
        if (deniedDirIds.size > 0) {
          const pagesInDeniedDirs = await this.pageRepo.findPageIdsByDirectoryIds(
            [...deniedDirIds],
          );
          for (const pid of pagesInDeniedDirs) {
            excludedPageIds.add(pid);
          }
        }
      }
    }

    const zipFileStream = await this.exportService.exportPages(
      dto.pageId,
      dto.format,
      dto.includeAttachments,
      dto.includeChildren,
      excludedPageIds,
    );

    const fileName = sanitize(page.title || 'untitled') + '.zip';

    res.headers({
      'Content-Type': 'application/zip',
      'Content-Disposition':
        'attachment; filename="' + encodeURIComponent(fileName) + '"',
    });

    res.send(zipFileStream);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('spaces/export')
  async exportSpace(
    @Body() dto: ExportSpaceDto,
    @AuthUser() user: User,
    @Res() res: FastifyReply,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const exportFile = await this.exportService.exportSpace(
      dto.spaceId,
      dto.format,
      dto.includeAttachments,
    );

    res.headers({
      'Content-Type': 'application/zip',
      'Content-Disposition':
        'attachment; filename="' +
        encodeURIComponent(sanitize(exportFile.fileName)) +
        '"',
    });

    res.send(exportFile.fileStream);
  }
}
