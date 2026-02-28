import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TopicRepo } from '@docmost/db/repos/topic/topic.repo';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';
import { CreateTopicDto, UpdateTopicDto } from './dto/topic.dto';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';
import slugify = require('@sindresorhus/slugify');

@Injectable()
export class TopicService {
  constructor(
    private readonly topicRepo: TopicRepo,
    private readonly directoryRepo: DirectoryRepo,
  ) {}

  async getTopicById(topicId: string, workspaceId: string) {
    return this.topicRepo.findById(topicId, workspaceId);
  }

  async getTopicsInDirectory(
    directoryId: string,
    workspaceId: string,
    pagination: PaginationOptions,
  ) {
    return this.topicRepo.getTopicsInDirectory(
      directoryId,
      workspaceId,
      pagination,
    );
  }

  async createTopic(dto: CreateTopicDto, user: User, workspace: Workspace) {
    // Look up parent directory to get spaceId
    const directory = await this.directoryRepo.findById(
      dto.directoryId,
      workspace.id,
    );
    if (!directory) {
      throw new NotFoundException('Directory not found');
    }

    const slug = slugify(dto.name);

    const slugExists = await this.topicRepo.slugExists(slug, dto.directoryId);
    if (slugExists) {
      throw new BadRequestException(
        'A topic with this slug already exists in this directory',
      );
    }

    const position = generateJitteredKeyBetween(null, null);

    return this.topicRepo.insertTopic({
      name: dto.name,
      description: dto.description || null,
      icon: dto.icon || null,
      slug,
      position,
      directoryId: dto.directoryId,
      spaceId: directory.spaceId,
      workspaceId: workspace.id,
      creatorId: user.id,
    });
  }

  async updateTopic(dto: UpdateTopicDto, workspaceId: string) {
    const updateData: any = {};
    if (dto.name !== undefined) {
      updateData.name = dto.name;
      // Regenerate slug when name changes
      const topic = await this.topicRepo.findById(dto.topicId, workspaceId);
      const newSlug = slugify(dto.name);
      const slugExists = await this.topicRepo.slugExists(
        newSlug,
        topic.directoryId,
        dto.topicId,
      );
      if (slugExists) {
        throw new BadRequestException(
          'A topic with this slug already exists in this directory',
        );
      }
      updateData.slug = newSlug;
    }
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;

    return this.topicRepo.updateTopic(
      updateData,
      dto.topicId,
      workspaceId,
    );
  }

  async deleteTopic(topicId: string, workspaceId: string) {
    await this.topicRepo.deleteTopic(topicId, workspaceId);
  }
}
