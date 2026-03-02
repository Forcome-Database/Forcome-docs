import { BadRequestException, Injectable } from '@nestjs/common';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';
import { CreateDirectoryDto, UpdateDirectoryDto } from './dto/directory.dto';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';
import slugify = require('@sindresorhus/slugify');
import { nanoIdGen } from '../../common/helpers/nanoid.utils';

@Injectable()
export class DirectoryService {
  constructor(private readonly directoryRepo: DirectoryRepo) {}

  async getDirectoryById(directoryId: string, workspaceId: string) {
    return this.directoryRepo.findById(directoryId, workspaceId);
  }

  async getDirectoriesInSpace(
    spaceId: string,
    workspaceId: string,
    pagination: PaginationOptions,
  ) {
    return this.directoryRepo.getDirectoriesInSpace(
      spaceId,
      workspaceId,
      pagination,
    );
  }

  async createDirectory(
    dto: CreateDirectoryDto,
    user: User,
    workspace: Workspace,
  ) {
    const slug = slugify(dto.name) || nanoIdGen();

    const slugExists = await this.directoryRepo.slugExists(slug, dto.spaceId);
    if (slugExists) {
      throw new BadRequestException(
        'A directory with this slug already exists in this space',
      );
    }

    const position = generateJitteredKeyBetween(null, null);

    return this.directoryRepo.insertDirectory({
      name: dto.name,
      description: dto.description || null,
      icon: dto.icon || null,
      slug,
      position,
      spaceId: dto.spaceId,
      workspaceId: workspace.id,
      creatorId: user.id,
    });
  }

  async updateDirectory(dto: UpdateDirectoryDto, workspaceId: string) {
    const updateData: any = {};
    if (dto.name !== undefined) {
      updateData.name = dto.name;
      // Regenerate slug when name changes
      const directory = await this.directoryRepo.findById(
        dto.directoryId,
        workspaceId,
      );
      const newSlug = slugify(dto.name) || nanoIdGen();
      const slugExists = await this.directoryRepo.slugExists(
        newSlug,
        directory.spaceId,
        dto.directoryId,
      );
      if (slugExists) {
        throw new BadRequestException(
          'A directory with this slug already exists in this space',
        );
      }
      updateData.slug = newSlug;
    }
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;

    return this.directoryRepo.updateDirectory(
      updateData,
      dto.directoryId,
      workspaceId,
    );
  }

  async deleteDirectory(directoryId: string, workspaceId: string) {
    await this.directoryRepo.deleteDirectory(directoryId, workspaceId);
  }
}
