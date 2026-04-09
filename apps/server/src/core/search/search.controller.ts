import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SearchService } from './search.service';
import {
  SearchDTO,
  SearchShareDTO,
  SearchSuggestionDTO,
} from './dto/search.dto';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { ModuleRef } from '@nestjs/core';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';

@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly environmentService: EnvironmentService,
    private moduleRef: ModuleRef,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly resourcePermRepo: ResourcePermissionRepo,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async pageSearch(
    @Body() searchDto: SearchDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    delete searchDto.shareId;

    if (searchDto.spaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        searchDto.spaceId,
      );

      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    if (this.environmentService.getSearchDriver() === 'typesense') {
      return this.searchTypesense(searchDto, {
        userId: user.id,
        workspaceId: workspace.id,
      });
    }

    const result = await this.searchService.searchPage(searchDto, {
      userId: user.id,
      workspaceId: workspace.id,
    });

    // Apply resource-level permission filtering
    result.items = await this.filterSearchResultsByPermission(
      result.items, user.id, workspace.id,
    );

    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post('suggest')
  async searchSuggestions(
    @Body() dto: SearchSuggestionDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const result = await this.searchService.searchSuggestions(dto, user.id, workspace.id);

    // Apply resource-level permission filtering on pages
    if (result.pages && result.pages.length > 0) {
      result.pages = await this.filterSearchResultsByPermission(
        result.pages, user.id, workspace.id,
      );
    }

    return result;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('share-search')
  async searchShare(
    @Body() searchDto: SearchShareDTO,
    @AuthWorkspace() workspace: Workspace,
  ) {
    delete searchDto.spaceId;
    if (!searchDto.shareId) {
      throw new BadRequestException('shareId is required');
    }

    if (this.environmentService.getSearchDriver() === 'typesense') {
      return this.searchTypesense(searchDto, {
        workspaceId: workspace.id,
      });
    }

    return this.searchService.searchPage(searchDto, {
      workspaceId: workspace.id,
    });
  }

  /**
   * Filter search results by resource-level permissions.
   * - restricted (spaceRole='none'): only return pages with explicit override
   * - normal users: filter out pages with 'none' override
   */
  private async filterSearchResultsByPermission<T extends { id: string; spaceId?: string; directoryId?: string | null }>(
    items: T[],
    userId: string,
    workspaceId: string,
  ): Promise<T[]> {
    if (items.length === 0) return items;

    // Collect unique spaceIds from the results
    const spaceIds = [...new Set(items.map(item => item.spaceId).filter(Boolean))] as string[];
    if (spaceIds.length === 0) return items;

    // For each space, determine user's role and overrides
    const spaceOverridesMap = new Map<string, {
      spaceRole: string | undefined;
      overrides: { resourceType: string; resourceId: string; role: string; directoryId: string | null }[];
    }>();

    await Promise.all(
      spaceIds.map(async (spaceId) => {
        const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(userId, spaceId);
        const spaceRole = findHighestUserSpaceRole(userSpaceRoles);
        const overrides = await this.resourcePermRepo.getUserOverridesInSpace(userId, spaceId, workspaceId);
        spaceOverridesMap.set(spaceId, { spaceRole, overrides });
      }),
    );

    return items.filter(item => {
      const spaceId = item.spaceId;
      if (!spaceId) return true; // No spaceId, can't filter

      const entry = spaceOverridesMap.get(spaceId);
      if (!entry) return true;

      const { spaceRole, overrides } = entry;

      if (spaceRole === 'none') {
        // Restricted user: only show pages with explicit non-none override
        const allowedPageIds = new Set<string>();
        const allowedDirIds = new Set<string>();
        for (const o of overrides) {
          if (o.role === 'none') continue;
          if (o.resourceType === 'page') allowedPageIds.add(o.resourceId);
          if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
        }
        return allowedPageIds.has(item.id) || (item.directoryId && allowedDirIds.has(item.directoryId));
      } else {
        // Normal user: hide pages with 'none' override
        const deniedPageIds = new Set<string>();
        const deniedDirIds = new Set<string>();
        for (const o of overrides) {
          if (o.role !== 'none') continue;
          if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
          if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
        }
        if (deniedPageIds.has(item.id)) return false;
        if (item.directoryId && deniedDirIds.has(item.directoryId)) return false;
        return true;
      }
    });
  }

  async searchTypesense(
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
    },
  ) {
    const { userId, workspaceId } = opts;
    let TypesenseModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      TypesenseModule = require('./../../ee/typesense/services/page-search.service');

      const PageSearchService = this.moduleRef.get(
        TypesenseModule.PageSearchService,
        {
          strict: false,
        },
      );

      return PageSearchService.searchPage(searchParams, {
        userId: userId,
        workspaceId,
      });
    } catch (err) {
      this.logger.debug(
        'Typesense module requested but enterprise module not bundled in this build',
      );
    }

    throw new BadRequestException('Enterprise Typesense search module missing');
  }
}
