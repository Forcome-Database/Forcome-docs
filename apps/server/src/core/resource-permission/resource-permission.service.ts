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
  ): Promise<ResourcePermission> {
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

  @OnEvent('directory.deleted')
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
