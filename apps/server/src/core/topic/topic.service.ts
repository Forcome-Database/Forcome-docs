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
import { generateSlug } from '../../common/helpers/nanoid.utils';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueName, QueueJob } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';

@Injectable()
export class TopicService {
  constructor(
    private readonly topicRepo: TopicRepo,
    private readonly directoryRepo: DirectoryRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
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

    const slug = generateSlug(dto.name);

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
      const topic = await this.topicRepo.findById(dto.topicId, workspaceId);
      updateData.name = dto.name;
      // Only regenerate slug when name actually changes
      if (dto.name !== topic.name) {
        const newSlug = generateSlug(dto.name);
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
    }
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.position !== undefined) updateData.position = dto.position;

    return this.topicRepo.updateTopic(
      updateData,
      dto.topicId,
      workspaceId,
    );
  }

  async deleteTopic(topicId: string, workspaceId: string) {
    // 1. Find affected pages before soft-deleting
    const affectedPages = await this.db
      .selectFrom('pages')
      .select('id')
      .where('topicId', '=', topicId)
      .where('deletedAt', 'is', null)
      .execute();

    // 2. Clear pages' topic reference (keep directoryId)
    await this.db
      .updateTable('pages')
      .set({ topicId: null })
      .where('topicId', '=', topicId)
      .execute();

    // 3. Soft-delete topic
    await this.topicRepo.deleteTopic(topicId, workspaceId);

    // 4. Sync embeddings for affected pages
    if (affectedPages.length > 0) {
      const pageIds = affectedPages.map((p) => p.id);
      await this.aiQueue.add(QueueJob.PAGE_MOVED_TO_SPACE, {
        pageId: pageIds,
        workspaceId,
      });
    }
  }
}
