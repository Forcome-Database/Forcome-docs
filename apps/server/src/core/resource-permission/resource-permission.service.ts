import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { ResourcePermission } from '@docmost/db/types/entity.types';
import { AddResourcePermissionDto } from './dto/add-resource-permission.dto';
import { EventName } from '../../common/events/event.contants';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';

export interface DirectoryDeletedEvent {
  directoryId: string;
}

export interface PageDeletedEvent {
  pageIds: string[];
  workspaceId: string;
}

@Injectable()
export class ResourcePermissionService {
  constructor(
    private readonly resourcePermRepo: ResourcePermissionRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async list(
    resourceType: 'directory' | 'page',
    resourceId: string,
  ): Promise<ResourcePermission[]> {
    return this.resourcePermRepo.listByResource(resourceType, resourceId);
  }

  async add(
    dto: AddResourcePermissionDto,
    userId: string,
    workspaceId: string,
    spaceId: string,
  ): Promise<ResourcePermission> {
    // Self-lock prevention: don't let user set their own permission to 'none'
    if (
      dto.principalType === 'user' &&
      dto.principalId === userId &&
      dto.role === 'none'
    ) {
      throw new BadRequestException(
        'Cannot set your own permission to none',
      );
    }

    // Automatically add the principal as a space Reader if not already a member
    await this.ensureSpaceMembership(dto.principalType, dto.principalId, spaceId);

    return this.resourcePermRepo.insert({
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      principalType: dto.principalType,
      principalId: dto.principalId,
      role: dto.role,
      workspaceId,
      createdBy: userId,
    });
  }

  private async ensureSpaceMembership(
    principalType: string,
    principalId: string,
    spaceId: string,
  ): Promise<void> {
    const opts =
      principalType === 'user'
        ? { userId: principalId }
        : { groupId: principalId };

    const existing = await this.spaceMemberRepo.getSpaceMemberByTypeId(
      spaceId,
      opts,
    );
    if (existing) return; // Already a space member, no action needed

    await this.spaceMemberRepo.insertSpaceMember({
      userId: principalType === 'user' ? principalId : null,
      groupId: principalType === 'group' ? principalId : null,
      spaceId,
      role: 'reader',
    });
  }

  async updateRole(
    id: string,
    role: string,
    userId: string,
  ): Promise<void> {
    const record = await this.resourcePermRepo.findById(id);
    if (!record) {
      throw new NotFoundException('Permission record not found');
    }

    // Self-lock prevention: don't let admin downgrade their own direct-user entry to 'none'
    if (
      record.principalType === 'user' &&
      record.principalId === userId &&
      role === 'none'
    ) {
      throw new BadRequestException(
        'You cannot set your own permission to none',
      );
    }

    await this.resourcePermRepo.updateRole(id, role);
  }

  async remove(id: string, userId: string): Promise<void> {
    const record = await this.resourcePermRepo.findById(id);
    if (!record) {
      throw new NotFoundException('Permission record not found');
    }

    // Prevent removing the last admin
    if (record.role === 'admin') {
      const adminCount = await this.resourcePermRepo.countAdminsForResource(
        record.resourceType,
        record.resourceId,
      );
      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the last admin permission for this resource',
        );
      }
    }

    await this.resourcePermRepo.deleteById(id);
  }

  async findById(id: string): Promise<ResourcePermission | undefined> {
    return this.resourcePermRepo.findById(id);
  }

  @OnEvent(EventName.DIRECTORY_DELETED)
  async handleDirectoryDeleted(event: DirectoryDeletedEvent): Promise<void> {
    await this.resourcePermRepo.deleteByResource(
      'directory',
      event.directoryId,
    );
  }

  @OnEvent(EventName.PAGE_DELETED)
  async handlePageDeleted(event: PageDeletedEvent): Promise<void> {
    for (const pageId of event.pageIds) {
      await this.resourcePermRepo.deleteByResource('page', pageId);
    }
  }
}
