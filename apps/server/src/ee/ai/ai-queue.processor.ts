import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AiSearchService } from './services/ai-search.service';

@Processor(QueueName.AI_QUEUE)
export class AiQueueProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(AiQueueProcessor.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly aiSearchService: AiSearchService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      switch (job.name) {
        case QueueJob.WORKSPACE_CREATE_EMBEDDINGS: {
          await this.createEmbeddingsTable();
          await this.generateWorkspaceEmbeddings(job.data.workspaceId);
          break;
        }

        case QueueJob.WORKSPACE_DELETE_EMBEDDINGS: {
          await this.deleteWorkspaceEmbeddings(job.data.workspaceId);
          break;
        }

        case QueueJob.GENERATE_PAGE_EMBEDDINGS:
        case QueueJob.PAGE_CONTENT_UPDATED: {
          await this.generatePageEmbeddings(
            job.data.pageIds,
            job.data.workspaceId,
          );
          break;
        }

        case QueueJob.PAGE_CREATED: {
          // New pages may not have content yet, skip
          break;
        }

        case QueueJob.DELETE_PAGE_EMBEDDINGS:
        case QueueJob.PAGE_DELETED:
        case QueueJob.PAGE_SOFT_DELETED: {
          await this.deletePageEmbeddings(job.data.pageIds);
          break;
        }

        case QueueJob.PAGE_RESTORED: {
          await this.generatePageEmbeddings(
            job.data.pageIds,
            job.data.workspaceId,
          );
          break;
        }

        case QueueJob.PAGE_MOVED_TO_SPACE: {
          const { pageId, workspaceId } = job.data;
          const pageIds = Array.isArray(pageId) ? pageId : [pageId];
          for (const pid of pageIds) {
            const page = await this.db
              .selectFrom('pages')
              .select(['spaceId', 'directoryId', 'topicId'])
              .where('id', '=', pid)
              .executeTakeFirst();
            if (page) {
              await sql`
                UPDATE page_embeddings
                SET "spaceId" = ${page.spaceId},
                    "directoryId" = ${page.directoryId},
                    "topicId" = ${page.topicId},
                    "updatedAt" = NOW()
                WHERE "pageId" = ${pid}
              `.execute(this.db);
            }
          }
          break;
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Error processing ${job.name}: ${err?.message || err}`,
      );
      throw err;
    }
  }

  private async createEmbeddingsTable(): Promise<void> {
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(this.db);
    } catch (err: any) {
      this.logger.error(
        `Failed to create pgvector extension: ${err?.message}`,
      );
      throw err;
    }

    const dimension = this.environmentService.getAiEmbeddingDimension() || 1536;

    await sql`
      CREATE TABLE IF NOT EXISTS page_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "pageId" UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        "spaceId" UUID NOT NULL,
        "modelName" VARCHAR(255) NOT NULL,
        "modelDimensions" INTEGER NOT NULL,
        "workspaceId" UUID NOT NULL,
        "attachmentId" UUID,
        embedding vector(${sql.raw(String(dimension))}),
        "chunkIndex" INTEGER DEFAULT 0,
        "chunkStart" INTEGER DEFAULT 0,
        "chunkLength" INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
        "directoryId" UUID,
        "topicId" UUID,
        "deletedAt" TIMESTAMPTZ
      )
    `.execute(this.db);

    // Add directoryId/topicId columns if table already exists (idempotent)
    await sql`
      ALTER TABLE page_embeddings
      ADD COLUMN IF NOT EXISTS "directoryId" UUID,
      ADD COLUMN IF NOT EXISTS "topicId" UUID
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_workspace
      ON page_embeddings ("workspaceId")
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_page
      ON page_embeddings ("pageId")
    `.execute(this.db);

    this.logger.log('page_embeddings table created successfully');
  }

  private async generateWorkspaceEmbeddings(
    workspaceId: string,
  ): Promise<void> {
    const isConfigured =
      this.environmentService.getAiDriver() &&
      this.environmentService.getAiEmbeddingModel();

    if (!isConfigured) {
      this.logger.warn(
        'AI embedding not configured. Skipping workspace embedding generation.',
      );
      return;
    }

    const pages = await this.db
      .selectFrom('pages')
      .select(['id', 'title', 'textContent'])
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    for (const page of pages) {
      try {
        const text = `${page.title || ''}\n${page.textContent || ''}`.trim();
        if (!text) continue;

        await this.upsertPageEmbedding(page.id, workspaceId, text);
      } catch (err: any) {
        this.logger.error(
          `Failed to generate embedding for page ${page.id}: ${err?.message}`,
        );
      }
    }

    this.logger.log(
      `Generated embeddings for ${pages.length} pages in workspace ${workspaceId}`,
    );
  }

  private async generatePageEmbeddings(
    pageIds: string[],
    workspaceId: string,
  ): Promise<void> {
    if (!pageIds?.length || !workspaceId) return;

    const isConfigured =
      this.environmentService.getAiDriver() &&
      this.environmentService.getAiEmbeddingModel();

    if (!isConfigured) return;

    // Check if page_embeddings table exists
    const tableCheck = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = COALESCE(current_schema(), 'public')
        AND table_name = 'page_embeddings'
      ) as exists
    `.execute(this.db);

    if (!tableCheck.rows[0]?.exists) return;

    for (const pageId of pageIds) {
      try {
        const page = await this.db
          .selectFrom('pages')
          .select(['id', 'title', 'textContent'])
          .where('id', '=', pageId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!page) continue;

        const text = `${page.title || ''}\n${page.textContent || ''}`.trim();
        if (!text) continue;

        await this.upsertPageEmbedding(page.id, workspaceId, text);
      } catch (err: any) {
        this.logger.error(
          `Failed to generate embedding for page ${pageId}: ${err?.message}`,
        );
      }
    }
  }

  private async upsertPageEmbedding(
    pageId: string,
    workspaceId: string,
    text: string,
  ): Promise<void> {
    const embedding = await this.aiSearchService.generateEmbedding(text);
    const embeddingStr = `[${embedding.join(',')}]`;
    const modelName = this.environmentService.getAiEmbeddingModel();
    const dimension =
      this.environmentService.getAiEmbeddingDimension() || 1536;

    const page = await this.db
      .selectFrom('pages')
      .select(['spaceId'])
      .where('id', '=', pageId)
      .executeTakeFirst();

    if (!page) return;

    // Delete existing embeddings for this page
    await sql`
      DELETE FROM page_embeddings WHERE "pageId" = ${pageId}
    `.execute(this.db);

    // Insert new embedding
    await sql`
      INSERT INTO page_embeddings ("pageId", "spaceId", "workspaceId", "modelName", "modelDimensions", embedding)
      VALUES (${pageId}, ${page.spaceId}, ${workspaceId}, ${modelName}, ${dimension}, ${embeddingStr}::vector)
    `.execute(this.db);
  }

  private async deletePageEmbeddings(pageIds: string[]): Promise<void> {
    if (!pageIds?.length) return;

    const tableCheck = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = COALESCE(current_schema(), 'public')
        AND table_name = 'page_embeddings'
      ) as exists
    `.execute(this.db);

    if (!tableCheck.rows[0]?.exists) return;

    for (const pageId of pageIds) {
      await sql`
        DELETE FROM page_embeddings WHERE "pageId" = ${pageId}
      `.execute(this.db);
    }
  }

  private async deleteWorkspaceEmbeddings(workspaceId: string): Promise<void> {
    const tableCheck = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = COALESCE(current_schema(), 'public')
        AND table_name = 'page_embeddings'
      ) as exists
    `.execute(this.db);

    if (!tableCheck.rows[0]?.exists) return;

    await sql`
      DELETE FROM page_embeddings WHERE "workspaceId" = ${workspaceId}
    `.execute(this.db);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error(
      `Error processing ${job.name} job. Reason: ${job.failedReason}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
