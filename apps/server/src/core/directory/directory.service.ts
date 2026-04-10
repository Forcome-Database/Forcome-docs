import { BadRequestException, Injectable } from '@nestjs/common';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';
import { CreateDirectoryDto, UpdateDirectoryDto } from './dto/directory.dto';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { generateSlug } from '../../common/helpers/nanoid.utils';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueName, QueueJob } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';

@Injectable()
export class DirectoryService {
  constructor(
    private readonly directoryRepo: DirectoryRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
    const slug = generateSlug(dto.name);

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
      const directory = await this.directoryRepo.findById(
        dto.directoryId,
        workspaceId,
      );
      updateData.name = dto.name;
      // Only regenerate slug when name actually changes
      if (dto.name !== directory.name) {
        const newSlug = generateSlug(dto.name);
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
    }
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.position !== undefined) updateData.position = dto.position;
    if (dto.visibility !== undefined) updateData.visibility = dto.visibility;

    return this.directoryRepo.updateDirectory(
      updateData,
      dto.directoryId,
      workspaceId,
    );
  }

  async deleteDirectory(directoryId: string, workspaceId: string) {
    // 1. Find affected pages before soft-deleting
    const affectedPages = await this.db
      .selectFrom('pages')
      .select('id')
      .where('directoryId', '=', directoryId)
      .where('deletedAt', 'is', null)
      .execute();

    // 2. Soft-delete child topics
    await this.db
      .updateTable('topics')
      .set({ deletedAt: new Date() })
      .where('directoryId', '=', directoryId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    // 3. Clear pages' directory/topic references
    await this.db
      .updateTable('pages')
      .set({ directoryId: null, topicId: null })
      .where('directoryId', '=', directoryId)
      .execute();

    // 4. Soft-delete directory
    await this.directoryRepo.deleteDirectory(directoryId, workspaceId);

    // 5. Emit directory deleted event for permission cleanup
    this.eventEmitter.emit(EventName.DIRECTORY_DELETED, { directoryId });

    // 6. Sync embeddings for affected pages
    if (affectedPages.length > 0) {
      const pageIds = affectedPages.map((p) => p.id);
      await this.aiQueue.add(QueueJob.PAGE_MOVED_TO_SPACE, {
        pageId: pageIds,
        workspaceId,
      });
    }
  }
}
