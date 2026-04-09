import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { ResourcePermissionService } from './resource-permission.service';
import { ResourceAbilityFactory, ResourceContext } from '../casl/abilities/resource-ability.factory';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { ListResourcePermissionsDto } from './dto/list-resource-permissions.dto';
import { AddResourcePermissionDto } from './dto/add-resource-permission.dto';
import { UpdateResourcePermissionDto } from './dto/update-resource-permission.dto';
import { RemoveResourcePermissionDto } from './dto/remove-resource-permission.dto';

@UseGuards(JwtAuthGuard)
@Controller('resource-permissions')
export class ResourcePermissionController {
  constructor(
    private readonly resourcePermissionService: ResourcePermissionService,
    private readonly resourceAbilityFactory: ResourceAbilityFactory,
    private readonly pageRepo: PageRepo,
    private readonly directoryRepo: DirectoryRepo,
  ) {}

  private async resolveContext(
    resourceType: 'directory' | 'page',
    resourceId: string,
    workspaceId: string,
  ): Promise<ResourceContext> {
    if (resourceType === 'page') {
      const page = await this.pageRepo.findById(resourceId);
      if (!page || page.workspaceId !== workspaceId) {
        throw new NotFoundException('Page not found');
      }
      return {
        directoryId: page.directoryId ?? undefined,
        spaceId: page.spaceId,
      };
    } else {
      const directory = await this.directoryRepo.findById(
        resourceId,
        workspaceId,
      );
      if (!directory) {
        throw new NotFoundException('Directory not found');
      }
      return {
        spaceId: directory.spaceId,
      };
    }
  }

  private async checkManagePermission(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    workspaceId: string,
  ): Promise<void> {
    const context = await this.resolveContext(
      resourceType,
      resourceId,
      workspaceId,
    );
    const ability = await this.resourceAbilityFactory.createForUser(
      user,
      resourceType,
      resourceId,
      context,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async list(
    @Body() dto: ListResourcePermissionsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.checkManagePermission(
      user,
      dto.resourceType,
      dto.resourceId,
      workspace.id,
    );
    return this.resourcePermissionService.list(dto.resourceType, dto.resourceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('add')
  async add(
    @Body() dto: AddResourcePermissionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.checkManagePermission(
      user,
      dto.resourceType,
      dto.resourceId,
      workspace.id,
    );
    return this.resourcePermissionService.add(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateResourcePermissionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const record = await this.resourcePermissionService.findById(dto.id);
    if (!record) {
      throw new NotFoundException('Permission record not found');
    }
    await this.checkManagePermission(
      user,
      record.resourceType as 'directory' | 'page',
      record.resourceId,
      workspace.id,
    );
    await this.resourcePermissionService.updateRole(dto.id, dto.role, user.id);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove')
  async remove(
    @Body() dto: RemoveResourcePermissionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const record = await this.resourcePermissionService.findById(dto.id);
    if (!record) {
      throw new NotFoundException('Permission record not found');
    }
    await this.checkManagePermission(
      user,
      record.resourceType as 'directory' | 'page',
      record.resourceId,
      workspace.id,
    );
    await this.resourcePermissionService.remove(dto.id, user.id);
    return { success: true };
  }
}
