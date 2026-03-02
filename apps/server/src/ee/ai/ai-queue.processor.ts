import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AiSearchService } from './services/ai-search.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { chunkText } from './utils/chunker';
import {
  extractImageNodes,
  extractDiagramNodes,
  extractDrawioText,
  extractExcalidrawText,
} from './utils/content-extractor';

@Processor(QueueName.AI_QUEUE)
export class AiQueueProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(AiQueueProcessor.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly aiSearchService: AiSearchService,
    private readonly storageService: StorageService,
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

    // Ensure embedding column has explicit dimensions (required for HNSW index)
    // If table was created by an older version without dimensions, this fixes it
    await sql`
      ALTER TABLE page_embeddings
      ALTER COLUMN embedding TYPE vector(${sql.raw(String(dimension))})
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_workspace
      ON page_embeddings ("workspaceId")
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_page
      ON page_embeddings ("pageId")
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_chunk
      ON page_embeddings ("pageId", "chunkIndex")
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_metadata_type
      ON page_embeddings USING GIN (metadata jsonb_path_ops)
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_page_embeddings_hnsw
      ON page_embeddings USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
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
      .select(['id', 'title', 'textContent', 'content'])
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    for (const page of pages) {
      try {
        const text = `${page.title || ''}\n${page.textContent || ''}`.trim();
        if (!text) continue;

        await this.upsertPageEmbedding(page.id, workspaceId, text, page.title || 'Untitled', page.content);
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
          .select(['id', 'title', 'textContent', 'content'])
          .where('id', '=', pageId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (!page) continue;

        const text = `${page.title || ''}\n${page.textContent || ''}`.trim();
        if (!text) continue;

        await this.upsertPageEmbedding(page.id, workspaceId, text, page.title || 'Untitled', page.content);
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
    pageTitle: string,
    prosemirrorContent?: any,
  ): Promise<void> {
    const modelName = this.environmentService.getAiEmbeddingModel();
    const dimension = this.environmentService.getAiEmbeddingDimension() || 1536;

    const page = await this.db
      .selectFrom('pages')
      .select(['spaceId', 'directoryId', 'topicId'])
      .where('id', '=', pageId)
      .executeTakeFirst();

    if (!page) return;

    // Delete existing embeddings for this page
    await sql`DELETE FROM page_embeddings WHERE "pageId" = ${pageId}`.execute(this.db);

    // === Text chunking + contextual embedding ===
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      try {
        const contextPrefix = await this.aiSearchService.generateContextPrefix(pageTitle, text, chunk.text);
        const embeddingText = `${contextPrefix}\n${chunk.text}`;
        const embedding = await this.aiSearchService.generateEmbedding(embeddingText);
        const embeddingStr = `[${embedding.join(',')}]`;

        await sql`
          INSERT INTO page_embeddings ("pageId", "spaceId", "workspaceId", "directoryId", "topicId",
            "modelName", "modelDimensions", embedding, "chunkIndex", "chunkStart", "chunkLength", metadata)
          VALUES (${pageId}, ${page.spaceId}, ${workspaceId}, ${page.directoryId ?? null}, ${page.topicId ?? null},
            ${modelName}, ${dimension}, ${embeddingStr}::vector,
            ${chunk.chunkIndex}, ${chunk.chunkStart}, ${chunk.chunkLength},
            ${JSON.stringify({ type: 'text', contextPrefix })}::jsonb)
        `.execute(this.db);
      } catch (err: any) {
        this.logger.warn(`Failed to embed chunk ${chunk.chunkIndex} of page ${pageId}: ${err?.message}`);
      }
    }

    // === Diagram text extraction ===
    if (prosemirrorContent) {
      const diagrams = extractDiagramNodes(prosemirrorContent);
      for (const diagram of diagrams) {
        try {
          const attachment = await this.db
            .selectFrom('attachments')
            .select(['id', 'filePath', 'fileName'])
            .where('id', '=', diagram.attachmentId)
            .executeTakeFirst();

          if (!attachment?.filePath) continue;

          const fileBuffer = await this.storageService.read(attachment.filePath);
          const fileContent = fileBuffer.toString('utf-8');

          let diagramText = '';
          if (diagram.type === 'drawio') {
            diagramText = extractDrawioText(fileContent);
          } else if (diagram.type === 'excalidraw') {
            diagramText = extractExcalidrawText(fileContent);
          }

          if (!diagramText.trim()) continue;

          const embText = `图表「${diagram.title || attachment.fileName || ''}」内容：${diagramText}`;
          const embedding = await this.aiSearchService.generateEmbedding(embText);
          const embeddingStr = `[${embedding.join(',')}]`;

          await sql`
            INSERT INTO page_embeddings ("pageId", "spaceId", "workspaceId", "directoryId", "topicId",
              "modelName", "modelDimensions", embedding, "chunkIndex", "chunkStart", "chunkLength",
              "attachmentId", metadata)
            VALUES (${pageId}, ${page.spaceId}, ${workspaceId}, ${page.directoryId ?? null}, ${page.topicId ?? null},
              ${modelName}, ${dimension}, ${embeddingStr}::vector,
              ${chunks.length}, 0, 0, ${diagram.attachmentId},
              ${JSON.stringify({ type: 'diagram', diagramType: diagram.type, title: diagram.title || '' })}::jsonb)
          `.execute(this.db);
        } catch (err: any) {
          this.logger.warn(`Failed to extract diagram ${diagram.attachmentId}: ${err?.message}`);
        }
      }

      // === Image VLM captioning ===
      const images = extractImageNodes(prosemirrorContent);
      this.logger.log(`Found ${images.length} images in page ${pageId}`);

      let imgIdx = 0;
      for (const img of images) {
        imgIdx++;
        try {
          // Check attachments.textContent cache first
          const attachment = await this.db
            .selectFrom('attachments')
            .select(['id', 'filePath', 'fileName', 'textContent', 'mimeType'])
            .where('id', '=', img.attachmentId)
            .executeTakeFirst();

          if (!attachment) {
            this.logger.warn(`Image attachment not found: ${img.attachmentId}`);
            continue;
          }

          let description = attachment.textContent;

          if (description) {
            this.logger.debug(`Using cached description for ${img.attachmentId}: ${description.slice(0, 50)}...`);
          } else if (attachment.filePath) {
            // Generate description via VLM
            try {
              const imageBuffer = await this.storageService.read(attachment.filePath);
              const mimeType = attachment.mimeType || 'image/png';

              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { generateText } = require('ai');
              const model = this.aiSearchService.getVlmModel();

              this.logger.log(`Calling VLM for image ${img.attachmentId} (${attachment.fileName}, ${imageBuffer.length} bytes)`);

              const result = await generateText({
                model,
                maxTokens: 200,
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'image', image: imageBuffer, mimeType },
                    { type: 'text', text: '用一段话描述这张图片的内容，包括关键信息和数据（不超过100字）。' },
                  ],
                }],
              });

              description = result.text?.trim() || '';

              // Cache to attachments.text_content
              if (description) {
                await sql`
                  UPDATE attachments SET text_content = ${description} WHERE id = ${img.attachmentId}
                `.execute(this.db);
                this.logger.log(`VLM caption success for ${img.attachmentId}: ${description.slice(0, 60)}...`);
              }
            } catch (vlmErr: any) {
              this.logger.warn(`VLM caption failed for ${img.attachmentId}: ${vlmErr?.message}`);
              // Fallback: use filename/alt as basic description
              description = `图片：${img.alt || attachment.fileName || `第${imgIdx}张图片`}`;
              this.logger.log(`Using fallback description for ${img.attachmentId}: ${description}`);
            }
          }

          // If still no description (no filePath and no cache), use filename/alt
          if (!description) {
            description = `图片：${img.alt || attachment?.fileName || `第${imgIdx}张图片`}`;
          }

          const embText = `图片「${img.alt || attachment.fileName || ''}」：${description}`;
          const embedding = await this.aiSearchService.generateEmbedding(embText);
          const embeddingStr = `[${embedding.join(',')}]`;

          await sql`
            INSERT INTO page_embeddings ("pageId", "spaceId", "workspaceId", "directoryId", "topicId",
              "modelName", "modelDimensions", embedding, "chunkIndex", "chunkStart", "chunkLength",
              "attachmentId", metadata)
            VALUES (${pageId}, ${page.spaceId}, ${workspaceId}, ${page.directoryId ?? null}, ${page.topicId ?? null},
              ${modelName}, ${dimension}, ${embeddingStr}::vector,
              ${chunks.length + imgIdx}, 0, 0, ${img.attachmentId},
              ${JSON.stringify({ type: 'image', description, alt: img.alt || '', attachmentId: img.attachmentId })}::jsonb)
          `.execute(this.db);
        } catch (err: any) {
          this.logger.warn(`Failed to process image ${img.attachmentId}: ${err?.message}`);
        }
      }
    }

    this.logger.log(`Generated ${chunks.length} chunk embeddings for page ${pageId}`);
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
