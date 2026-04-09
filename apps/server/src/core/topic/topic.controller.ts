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
import { TopicService } from './topic.service';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  CreateTopicDto,
  TopicIdDto,
  TopicListDto,
  UpdateTopicDto,
} from './dto/topic.dto';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';

@UseGuards(JwtAuthGuard)
@Controller('topics')
export class TopicController {
  constructor(
    private readonly topicService: TopicService,
    private readonly directoryRepo: DirectoryRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly resourcePermRepo: ResourcePermissionRepo,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async list(
    @Body() dto: TopicListDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    // Lookup directory to get spaceId for permission check
    const directory = await this.directoryRepo.findById(
      dto.directoryId,
      workspace.id,
    );
    if (!directory) throw new NotFoundException('Directory not found');

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      directory.spaceId,
    );
    const spaceRole = findHighestUserSpaceRole(userSpaceRoles);
    if (!spaceRole) throw new ForbiddenException();

    const result = await this.topicService.getTopicsInDirectory(
      dto.directoryId,
      workspace.id,
      pagination,
    );

    // For restricted users: only show topics that contain pages the user has access to
    if (spaceRole === 'none') {
      const overrides = await this.resourcePermRepo.getUserOverridesInSpace(
        user.id,
        directory.spaceId,
        workspace.id,
      );
      const allowedTopicIds = new Set<string>();
      for (const override of overrides) {
        if (override.role === 'none') continue;
        if (override.resourceType === 'page' && override.topicId) {
          allowedTopicIds.add(override.topicId);
        }
      }
      // If user has directory-level access, show all topics under it
      const hasDirectoryAccess = overrides.some(
        (o) => o.resourceType === 'directory' && o.resourceId === dto.directoryId && o.role !== 'none',
      );
      if (!hasDirectoryAccess) {
        result.items = result.items.filter((topic) => allowedTopicIds.has(topic.id));
      }
    }

    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async info(
    @Body() dto: TopicIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const topic = await this.topicService.getTopicById(
      dto.topicId,
      workspace.id,
    );
    if (!topic) throw new NotFoundException('Topic not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      topic.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return topic;
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateTopicDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    // Lookup directory to get spaceId for permission check
    const directory = await this.directoryRepo.findById(
      dto.directoryId,
      workspace.id,
    );
    if (!directory) throw new NotFoundException('Directory not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      directory.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.topicService.createTopic(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateTopicDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const topic = await this.topicService.getTopicById(
      dto.topicId,
      workspace.id,
    );
    if (!topic) throw new NotFoundException('Topic not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      topic.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.topicService.updateTopic(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(
    @Body() dto: TopicIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const topic = await this.topicService.getTopicById(
      dto.topicId,
      workspace.id,
    );
    if (!topic) throw new NotFoundException('Topic not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      topic.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    await this.topicService.deleteTopic(dto.topicId, workspace.id);
  }
}
