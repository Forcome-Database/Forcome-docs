import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { sql } from 'kysely';
import { streamText } from 'ai';
import { TokenService } from '../../../core/auth/services/token.service';
import {
  collectDocumentAssetProjections,
  collectDocumentAssetSources,
  collectDocumentLinkProjections,
  type DocumentAssetProjection,
  projectProsemirrorToContextText,
} from '../../../common/helpers/prosemirror/content-projection';
import { buildPublicAttachmentUrl } from '../../../core/share/share.util';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

export interface AiImagePayload {
  data: string;
  mimeType: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RetrievalScope {
  isPublicWiki?: boolean;
  allowedSpaceIds?: string[];
  allowedPageIds?: string[];
  currentPageId?: string;
}

export interface AiCitation {
  sourceType: 'page' | 'attachment' | 'image' | 'diagram';
  title: string;
  pageSlugId?: string;
  spaceSlug?: string;
  attachmentId?: string;
  pageUrl?: string;
  publicAssetUrl?: string;
  snippet?: string;
  chunkId?: string;
  span?: { start: number; end: number };
}

export interface AnswerWithContextInput {
  query: string;
  workspaceId: string;
  pageSlugId?: string;
  images?: AiImagePayload[];
  history?: AiChatMessage[];
  scope?: RetrievalScope;
}

interface SearchFilters {
  spaceId?: string;
  directoryId?: string;
  topicId?: string;
}

interface ChunkResult {
  pageId: string;
  title: string;
  slugId: string;
  spaceSlug: string;
  textContent: string;
  distance: number;
  chunkIndex: number;
  chunkStart?: number;
  chunkLength?: number;
  chunkText?: string;
  metadata?: any;
}

interface PageResult {
  pageId: string;
  title: string;
  slugId: string;
  spaceSlug: string;
  textContent: string;
  score: number;
  chunkText?: string;
  metadata?: any;
}

interface LegacySourceItem {
  title: string;
  slugId: string;
  spaceSlug: string;
  distance?: number;
  type?: string;
}

interface PageRecord {
  pageId: string;
  workspaceId: string;
  spaceId: string;
  title: string;
  slugId: string;
  spaceSlug: string;
  textContent: string;
  content?: any;
}

function getProsemirrorContent(content: any) {
  return (
    content ?? {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: 'left' } }],
    }
  );
}

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly tokenService?: TokenService,
  ) {}

  private buildInClause(values: string[]) {
    return sql.join(values.map((value) => sql`${value}`), sql`, `);
  }

  private buildPageScopeCondition(
    scope?: RetrievalScope,
    filters?: SearchFilters,
    alias = 'p',
  ) {
    const conditions: any[] = [];

    if (scope?.allowedSpaceIds) {
      if (scope.allowedSpaceIds.length === 0) {
        return sql`FALSE`;
      }
      conditions.push(
        sql`${sql.raw(`${alias}.space_id`)} in (${this.buildInClause(scope.allowedSpaceIds)})`,
      );
    }

    if (scope?.allowedPageIds) {
      if (scope.allowedPageIds.length === 0) {
        return sql`FALSE`;
      }
      conditions.push(
        sql`${sql.raw(`${alias}.id`)} in (${this.buildInClause(scope.allowedPageIds)})`,
      );
    }

    if (filters?.spaceId) {
      conditions.push(sql`${sql.raw(`${alias}.space_id`)} = ${filters.spaceId}`);
    }
    if (filters?.directoryId) {
      conditions.push(
        sql`${sql.raw(`${alias}.directory_id`)} = ${filters.directoryId}`,
      );
    }
    if (filters?.topicId) {
      conditions.push(sql`${sql.raw(`${alias}.topic_id`)} = ${filters.topicId}`);
    }

    return conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`TRUE`;
  }

  private buildEmbeddingScopeCondition(
    scope?: RetrievalScope,
    filters?: SearchFilters,
    embeddingAlias = 'pe',
    pageAlias = 'p',
  ) {
    const conditions: any[] = [];

    if (scope?.allowedSpaceIds) {
      if (scope.allowedSpaceIds.length === 0) {
        return sql`FALSE`;
      }
      conditions.push(
        sql`${sql.raw(`${embeddingAlias}."spaceId"`)} in (${this.buildInClause(scope.allowedSpaceIds)})`,
      );
    }

    if (scope?.allowedPageIds) {
      if (scope.allowedPageIds.length === 0) {
        return sql`FALSE`;
      }
      conditions.push(
        sql`${sql.raw(`${pageAlias}.id`)} in (${this.buildInClause(scope.allowedPageIds)})`,
      );
    }

    if (filters?.spaceId) {
      conditions.push(
        sql`${sql.raw(`${embeddingAlias}."spaceId"`)} = ${filters.spaceId}`,
      );
    }
    if (filters?.directoryId) {
      conditions.push(
        sql`${sql.raw(`${embeddingAlias}."directoryId"`)} = ${filters.directoryId}`,
      );
    }
    if (filters?.topicId) {
      conditions.push(
        sql`${sql.raw(`${embeddingAlias}."topicId"`)} = ${filters.topicId}`,
      );
    }

    return conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`TRUE`;
  }

  private createPageUrl(page: Pick<PageRecord, 'spaceSlug' | 'slugId'>): string {
    const wikiUrl = (this.environmentService.getWikiUrl() || '').trim();
    if (wikiUrl) {
      return `${wikiUrl.replace(/\/$/, '')}/${page.spaceSlug}/${page.slugId}`;
    }
    return `/docs/${page.spaceSlug}/${page.slugId}`;
  }

  private buildAppAssetUrl(
    asset: Pick<DocumentAssetProjection, 'attachmentId' | 'rawUrl' | 'title'>,
  ): string {
    const rawUrl =
      asset.rawUrl || `/api/files/${asset.attachmentId}/${asset.title}`;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return rawUrl;
    }
    return `${this.environmentService.getAppUrl()}${rawUrl}`;
  }

  private async buildResolvedAssetUrl(
    page: Pick<PageRecord, 'pageId' | 'workspaceId'>,
    asset: Pick<DocumentAssetProjection, 'attachmentId' | 'rawUrl' | 'title'>,
    scope?: RetrievalScope,
  ): Promise<string> {
    if (!scope?.isPublicWiki) {
      return this.buildAppAssetUrl(asset);
    }

    if (!this.tokenService) {
      return this.buildAppAssetUrl(asset);
    }

    const token = await this.tokenService.generateAttachmentToken({
      attachmentId: asset.attachmentId,
      pageId: page.pageId,
      workspaceId: page.workspaceId,
    });

    const rawUrl =
      asset.rawUrl || `/api/files/${asset.attachmentId}/${asset.title}`;
    return `${this.environmentService.getAppUrl()}${buildPublicAttachmentUrl(rawUrl, token)}`;
  }

  private createPageCitation(page: PageRecord): AiCitation {
    return {
      sourceType: 'page',
      title: page.title,
      pageSlugId: page.slugId,
      spaceSlug: page.spaceSlug,
      pageUrl: this.createPageUrl(page),
    };
  }

  private dedupePageSources(sources: LegacySourceItem[]): LegacySourceItem[] {
    const seen = new Set<string>();
    return sources.filter((source) => {
      const key = `${source.spaceSlug}:${source.slugId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private dedupeCitations(citations: AiCitation[]): AiCitation[] {
    const seen = new Set<string>();
    return citations.filter((citation) => {
      const key = [
        citation.sourceType,
        citation.spaceSlug || '',
        citation.pageSlugId || '',
        citation.attachmentId || '',
        citation.title,
      ].join(':');

      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async loadPageRecords(
    workspaceId: string,
    pageIds: string[],
    scope?: RetrievalScope,
  ): Promise<Map<string, PageRecord>> {
    const uniquePageIds = Array.from(new Set(pageIds.filter(Boolean)));
    if (uniquePageIds.length === 0) {
      return new Map();
    }

    const scopeCondition = this.buildPageScopeCondition(scope);
    const result = await sql`
      SELECT
        p.id as "pageId",
        p.workspace_id as "workspaceId",
        p.space_id as "spaceId",
        p.title,
        p.slug_id as "slugId",
        s.slug as "spaceSlug",
        p.text_content as "textContent",
        p.content
      FROM pages p
      JOIN spaces s ON s.id = p.space_id
      WHERE p.workspace_id = ${workspaceId}
        AND p.deleted_at IS NULL
        AND p.id in (${this.buildInClause(uniquePageIds)})
        AND ${scopeCondition}
    `.execute(this.db);

    return new Map(
      (result.rows as any[]).map((row) => [
        row.pageId,
        {
          pageId: row.pageId,
          workspaceId: row.workspaceId,
          spaceId: row.spaceId,
          title: row.title,
          slugId: row.slugId,
          spaceSlug: row.spaceSlug,
          textContent: row.textContent,
          content: row.content,
        } satisfies PageRecord,
      ]),
    );
  }

  private async loadCurrentPage(
    input: AnswerWithContextInput,
  ): Promise<PageRecord | null> {
    if (!input.pageSlugId) {
      return null;
    }

    const scopeCondition = this.buildPageScopeCondition(input.scope);
    const currentPageCondition = input.scope?.currentPageId
      ? sql`AND p.id = ${input.scope.currentPageId}`
      : sql``;

    const result = await sql`
      SELECT
        p.id as "pageId",
        p.workspace_id as "workspaceId",
        p.space_id as "spaceId",
        p.title,
        p.slug_id as "slugId",
        s.slug as "spaceSlug",
        p.text_content as "textContent",
        p.content
      FROM pages p
      JOIN spaces s ON s.id = p.space_id
      WHERE p.workspace_id = ${input.workspaceId}
        AND p.slug_id = ${input.pageSlugId}
        AND p.deleted_at IS NULL
        AND ${scopeCondition}
        ${currentPageCondition}
      LIMIT 1
    `.execute(this.db);

    if (!result.rows.length) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      pageId: row.pageId,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      title: row.title,
      slugId: row.slugId,
      spaceSlug: row.spaceSlug,
      textContent: row.textContent,
      content: row.content,
    };
  }

  private async loadImageDescriptionMaps(pageIds: string[]) {
    const uniquePageIds = Array.from(new Set(pageIds.filter(Boolean)));
    const maps = new Map<string, Map<string, string>>();

    if (uniquePageIds.length === 0) {
      return maps;
    }

    const result = await sql`
      SELECT "pageId", "attachmentId", metadata
      FROM page_embeddings
      WHERE "pageId" in (${this.buildInClause(uniquePageIds)})
        AND "deletedAt" IS NULL
        AND (metadata->>'type') = 'image'
    `.execute(this.db);

    for (const row of result.rows as any[]) {
      const pageId = row.pageId;
      const attachmentId = row.attachmentId;
      const description = row.metadata?.description;

      if (!pageId || !attachmentId || !description) {
        continue;
      }

      if (!maps.has(pageId)) {
        maps.set(pageId, new Map<string, string>());
      }
      maps.get(pageId)!.set(attachmentId, description);
    }

    return maps;
  }

  private async buildContextText(
    page: PageRecord,
    scope: RetrievalScope | undefined,
    imageDescriptions?: Map<string, string>,
  ) {
    if (!page.content) {
      return (page.textContent || '').trim();
    }

    const document = getProsemirrorContent(page.content);
    const assets = collectDocumentAssetProjections(document, imageDescriptions);
    const resolvedUrlMap = new Map<string, string>();

    for (const asset of assets) {
      resolvedUrlMap.set(
        asset.attachmentId,
        await this.buildResolvedAssetUrl(page, asset, scope),
      );
    }

    const linkSummary = collectDocumentLinkProjections(document)
      .slice(0, 10)
      .map((link) => `- ${link.text}: ${link.href}`)
      .join('\n');
    const body = projectProsemirrorToContextText(document, {
      imageDescriptions,
      resolveAssetUrl: (asset) =>
        resolvedUrlMap.get(asset.attachmentId) || asset.rawUrl,
    });

    if (!linkSummary) {
      return body;
    }

    return `Explicit links:\n${linkSummary}\n\n${body}`.trim();
  }

  private async collectAssetCitationsForPage(
    page: PageRecord,
    scope?: RetrievalScope,
    imageDescriptions?: Map<string, string>,
  ): Promise<AiCitation[]> {
    if (!page.content) {
      return [];
    }

    const document = getProsemirrorContent(page.content);
    const assets = collectDocumentAssetProjections(document, imageDescriptions);
    const rawUrlMap = new Map(
      assets.map((asset) => [asset.attachmentId, asset.rawUrl]),
    );
    const rawCitations = collectDocumentAssetSources(document, {
        pageId: page.pageId,
        pageSlugId: page.slugId,
        pageTitle: page.title,
        pageUrl: this.createPageUrl(page),
        spaceSlug: page.spaceSlug,
        imageDescriptions,
      });

    return Promise.all(
      rawCitations.map(async (citation) => {
        return {
          sourceType: citation.sourceType,
          title: citation.title,
          pageSlugId: citation.pageSlugId,
          spaceSlug: citation.spaceSlug,
          attachmentId: citation.attachmentId,
          pageUrl: citation.pageUrl,
          publicAssetUrl: await this.buildResolvedAssetUrl(
            page,
            {
              attachmentId: citation.attachmentId,
              rawUrl: rawUrlMap.get(citation.attachmentId),
              title: citation.title,
            },
            scope,
          ),
          snippet: citation.snippet,
        } as AiCitation;
      }),
    );
  }

  private matchesAssetQuery(citation: AiCitation, haystack: string): boolean {
    const normalizedHaystack = haystack.toLowerCase();
    const candidates = [citation.title, citation.snippet].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const lowerCandidate = candidate.toLowerCase();
      if (normalizedHaystack.includes(lowerCandidate)) {
        return true;
      }

      const tokens = lowerCandidate
        .split(/[^a-z0-9\u4e00-\u9fa5._-]+/i)
        .filter((token) => token.length >= 3);
      if (tokens.some((token) => normalizedHaystack.includes(token))) {
        return true;
      }
    }

    return false;
  }

  private async selectRelevantAssetCitations(
    page: PageRecord,
    query: string,
    result: PageResult,
    scope?: RetrievalScope,
    imageDescriptions?: Map<string, string>,
  ): Promise<AiCitation[]> {
    const allAssets = await this.collectAssetCitationsForPage(
      page,
      scope,
      imageDescriptions,
    );

    if (allAssets.length === 0) {
      return [];
    }

    if (result.metadata?.attachmentId) {
      return allAssets.filter(
        (asset) => asset.attachmentId === result.metadata.attachmentId,
      );
    }

    const haystack = `${query}\n${result.chunkText || ''}\n${result.textContent || ''}`;
    const matches = allAssets.filter((asset) =>
      this.matchesAssetQuery(asset, haystack),
    );

    return matches.slice(0, 3);
  }

  private formatCitationHint(citation: AiCitation): string {
    if (citation.publicAssetUrl) {
      return `- ${citation.title}: ${citation.publicAssetUrl}`;
    }
    if (citation.pageUrl) {
      return `- ${citation.title}: ${citation.pageUrl}`;
    }
    return `- ${citation.title}`;
  }

  // ==================== Model Providers ====================

  private getEmbeddingModel() {
    const driver = this.environmentService.getAiDriver();
    const modelName = this.environmentService.getAiEmbeddingModel();
    if (!driver || !modelName) {
      throw new BadRequestException(
        'AI embedding is not configured. Please set AI_DRIVER and AI_EMBEDDING_MODEL.',
      );
    }
    switch (driver) {
      case 'openai': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { openai } = require('@ai-sdk/openai');
        return openai.embedding(modelName);
      }
      case 'openai-compatible': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
        const provider = createOpenAICompatible({
          baseURL: this.environmentService.getOpenAiApiUrl(),
          apiKey: this.environmentService.getOpenAiApiKey(),
          name: 'openai-compatible',
        });
        return provider.textEmbeddingModel(modelName);
      }
      case 'gemini': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { google } = require('@ai-sdk/google');
        return google.textEmbeddingModel(modelName);
      }
      case 'ollama': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ollama } = require('ai-sdk-ollama');
        return ollama.embedding(modelName);
      }
      default:
        throw new BadRequestException(`Unsupported AI driver: ${driver}`);
    }
  }

  getCompletionModel() {
    const driver = this.environmentService.getAiDriver();
    const modelName = this.environmentService.getAiCompletionModel();
    if (!driver || !modelName) {
      throw new BadRequestException('AI completion model is not configured.');
    }
    return this.buildLanguageModel(driver, modelName);
  }

  getLiteModel() {
    const driver = this.environmentService.getAiDriver();
    const modelName = this.environmentService.getAiLiteModel();
    if (!driver || !modelName) {
      throw new BadRequestException('AI lite model is not configured.');
    }
    return this.buildLanguageModel(driver, modelName);
  }

  getVlmModel() {
    const driver = this.environmentService.getAiVlmDriver();
    const modelName = this.environmentService.getAiVlmModel();
    if (!driver || !modelName) {
      throw new BadRequestException('AI VLM model is not configured.');
    }
    return this.buildLanguageModel(driver, modelName);
  }

  private buildLanguageModel(driver: string, modelName: string) {
    switch (driver) {
      case 'openai': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { openai } = require('@ai-sdk/openai');
        return openai(modelName);
      }
      case 'openai-compatible': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
        const provider = createOpenAICompatible({
          baseURL: this.environmentService.getOpenAiApiUrl(),
          apiKey: this.environmentService.getOpenAiApiKey(),
          name: 'openai-compatible',
        });
        return provider(modelName);
      }
      case 'gemini': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { google } = require('@ai-sdk/google');
        return google(modelName);
      }
      case 'ollama': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ollama } = require('ai-sdk-ollama');
        return ollama(modelName);
      }
      default:
        throw new BadRequestException(`Unsupported AI driver: ${driver}`);
    }
  }

  // ==================== Embedding ====================

  async generateEmbedding(text: string): Promise<number[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { embed } = require('ai');
    const model = this.getEmbeddingModel();
    const { embedding } = await embed({ model, value: text });
    return embedding;
  }

  async generateContextPrefix(
    pageTitle: string,
    fullText: string,
    chunkText: string,
  ): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const model = this.getLiteModel();

      const docSnippet = fullText.slice(0, 1000);
      const { text } = await generateText({
        model,
        maxTokens: 80,
        messages: [
          {
            role: 'user',
            content: `Document title: ${pageTitle}\nDocument summary: ${docSnippet}\n\nChunk:\n${chunkText.slice(0, 300)}\n\nSummarize the chunk context in one short sentence.`,
          },
        ],
      });

      return text?.trim() || `This chunk comes from "${pageTitle}".`;
    } catch (err: any) {
      this.logger.warn(
        `Context prefix generation failed, using fallback: ${err?.message}`,
      );
      return `This chunk comes from "${pageTitle}".`;
    }
  }

  // ==================== Retrieval ====================

  async searchSimilarChunks(
    query: string,
    workspaceId: string,
    limit = 20,
    distanceThreshold = 0.5,
    filters?: SearchFilters,
    scope?: RetrievalScope,
  ): Promise<ChunkResult[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const scopeCondition = this.buildEmbeddingScopeCondition(
      scope,
      filters,
      'pe',
      'p',
    );

    const results = await sql`
      SELECT
        pe."pageId",
        p.title,
        p.slug_id as "slugId",
        p.text_content as "textContent",
        s.slug as "spaceSlug",
        pe."chunkIndex",
        pe."chunkStart",
        pe."chunkLength",
        pe.metadata,
        pe.embedding <=> ${embeddingStr}::vector AS distance
      FROM page_embeddings pe
      JOIN pages p ON p.id = pe."pageId"
      JOIN spaces s ON s.id = pe."spaceId"
      WHERE pe."workspaceId" = ${workspaceId}
        AND p.deleted_at IS NULL
        AND pe."deletedAt" IS NULL
        AND (pe.embedding <=> ${embeddingStr}::vector) < ${distanceThreshold}
        AND ${scopeCondition}
      ORDER BY distance ASC
      LIMIT ${limit}
    `.execute(this.db);

    return (results.rows as any[]).map((row) => {
      let chunkText: string | undefined;
      if (row.metadata?.chunkText) {
        chunkText = row.metadata.chunkText;
      } else if (row.metadata?.type === 'image' && row.metadata?.description) {
        chunkText = row.metadata.description;
      } else if (row.metadata?.type === 'diagram' && row.metadata?.diagramType) {
        chunkText = `${row.metadata.title || 'Diagram'}: (diagram content)`;
      } else if (row.chunkLength > 0 && row.textContent) {
        chunkText = row.textContent.slice(
          row.chunkStart,
          row.chunkStart + row.chunkLength,
        );
      }

      return {
        pageId: row.pageId,
        title: row.title,
        slugId: row.slugId,
        spaceSlug: row.spaceSlug,
        textContent: row.textContent,
        distance: parseFloat(row.distance),
        chunkIndex: row.chunkIndex,
        chunkStart: row.chunkStart,
        chunkLength: row.chunkLength,
        chunkText,
        metadata: row.metadata,
      };
    });
  }

  async searchByBM25(
    query: string,
    workspaceId: string,
    limit = 20,
    filters?: SearchFilters,
    scope?: RetrievalScope,
  ): Promise<
    Array<{
      pageId: string;
      title: string;
      slugId: string;
      spaceSlug: string;
      textContent: string;
      rank: number;
    }>
  > {
    const searchQuery = tsquery(query.trim() + '*');
    const scopeCondition = this.buildPageScopeCondition(scope, filters, 'p');

    const results = await sql`
      SELECT
        p.id as "pageId",
        p.title,
        p.slug_id as "slugId",
        p.text_content as "textContent",
        s.slug as "spaceSlug",
        ts_rank(p.tsv, to_tsquery('english', f_unaccent(${searchQuery}))) as rank
      FROM pages p
      JOIN spaces s ON s.id = p.space_id
      WHERE p.workspace_id = ${workspaceId}
        AND p.deleted_at IS NULL
        AND p.tsv @@ to_tsquery('english', f_unaccent(${searchQuery}))
        AND ${scopeCondition}
      ORDER BY rank DESC
      LIMIT ${limit}
    `.execute(this.db);

    return (results.rows as any[]).map((row) => ({
      pageId: row.pageId,
      title: row.title,
      slugId: row.slugId,
      spaceSlug: row.spaceSlug,
      textContent: row.textContent,
      rank: parseFloat(row.rank),
    }));
  }

  async hybridSearch(
    query: string,
    workspaceId: string,
    limit = 15,
    filters?: SearchFilters,
    scope?: RetrievalScope,
  ): Promise<PageResult[]> {
    const rrfK = 60;

    const [chunks, bm25Results] = await Promise.all([
      this.searchSimilarChunks(query, workspaceId, 20, 0.5, filters, scope),
      this.searchByBM25(query, workspaceId, 20, filters, scope),
    ]);

    const scoreMap = new Map<string, PageResult>();
    const vectorPages: string[] = [];

    for (const chunk of chunks) {
      if (!scoreMap.has(chunk.pageId)) {
        vectorPages.push(chunk.pageId);
        scoreMap.set(chunk.pageId, {
          pageId: chunk.pageId,
          title: chunk.title,
          slugId: chunk.slugId,
          spaceSlug: chunk.spaceSlug,
          textContent: chunk.textContent,
          score: 0,
          chunkText: chunk.chunkText,
          metadata: chunk.metadata,
        });
      }
    }

    for (let index = 0; index < vectorPages.length; index++) {
      const entry = scoreMap.get(vectorPages[index])!;
      entry.score += 1 / (rrfK + index);
    }

    for (let index = 0; index < bm25Results.length; index++) {
      const result = bm25Results[index];
      const existing = scoreMap.get(result.pageId);
      if (existing) {
        existing.score += 1 / (rrfK + index);
      } else {
        scoreMap.set(result.pageId, {
          pageId: result.pageId,
          title: result.title,
          slugId: result.slugId,
          spaceSlug: result.spaceSlug,
          textContent: result.textContent,
          score: 1 / (rrfK + index),
        });
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ==================== Rerank ====================

  async rerank(
    query: string,
    candidates: PageResult[],
    topN = 5,
  ): Promise<PageResult[]> {
    if (candidates.length <= topN) return candidates;

    const rerankModel = this.environmentService.getAiRerankModel();
    if (rerankModel) {
      return this.rerankWithModel(query, candidates, topN, rerankModel);
    }
    return this.rerankWithLLM(query, candidates, topN);
  }

  private async rerankWithModel(
    query: string,
    candidates: PageResult[],
    topN: number,
    modelName: string,
  ): Promise<PageResult[]> {
    try {
      const baseUrl =
        this.environmentService.getAiRerankApiUrl() ||
        this.environmentService.getOpenAiApiUrl();
      const apiKey =
        this.environmentService.getAiRerankApiKey() ||
        this.environmentService.getOpenAiApiKey();

      const documents = candidates.slice(0, 20).map((candidate) =>
        (candidate.chunkText || candidate.textContent || '').slice(0, 500),
      );

      const response = await fetch(`${baseUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: modelName,
          query,
          documents,
          top_n: topN,
        }),
      });

      if (!response.ok) {
        throw new Error(`Rerank API error: ${response.status}`);
      }

      const data = (await response.json()) as any;
      return (data.results || [])
        .sort((a: any, b: any) => b.relevance_score - a.relevance_score)
        .slice(0, topN)
        .map((result: any) => candidates[result.index]);
    } catch (err: any) {
      this.logger.warn(
        `Rerank model failed, falling back to LLM rerank: ${err?.message}`,
      );
      return this.rerankWithLLM(query, candidates, topN);
    }
  }

  private async rerankWithLLM(
    query: string,
    candidates: PageResult[],
    topN: number,
  ): Promise<PageResult[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const model = this.getLiteModel();

      const candidateList = candidates
        .slice(0, 15)
        .map((candidate, index) => {
          const preview = (candidate.chunkText || candidate.textContent || '').slice(0, 300);
          return `[${index}] ${candidate.title}: ${preview}`;
        })
        .join('\n\n');

      const { text } = await generateText({
        model,
        maxTokens: 100,
        messages: [
          {
            role: 'user',
            content: `User question: ${query}\n\nChoose the most relevant document indices in descending order, separated by commas. Return at most ${topN} indices.\n\n${candidateList}`,
          },
        ],
      });

      const indices = text
        .replace(/[^\d,]/g, '')
        .split(',')
        .map((value) => parseInt(value.trim(), 10))
        .filter(
          (value) => !Number.isNaN(value) && value >= 0 && value < candidates.length,
        );

      const seen = new Set<number>();
      const reranked: PageResult[] = [];
      for (const index of indices) {
        if (!seen.has(index)) {
          seen.add(index);
          reranked.push(candidates[index]);
        }
        if (reranked.length >= topN) {
          break;
        }
      }

      for (const candidate of candidates) {
        if (!reranked.includes(candidate)) {
          reranked.push(candidate);
        }
        if (reranked.length >= topN) {
          break;
        }
      }

      return reranked;
    } catch (err: any) {
      this.logger.warn(`LLM rerank failed: ${err?.message}`);
      return candidates.slice(0, topN);
    }
  }

  // ==================== Answer With Context ====================

  async *answerWithContext(
    input: AnswerWithContextInput,
  ): AsyncGenerator<string> {
    const currentPage = await this.loadCurrentPage(input);
    const hybridResults = await this.hybridSearch(
      input.query,
      input.workspaceId,
      15,
      undefined,
      input.scope,
    );
    const reranked = await this.rerank(input.query, hybridResults, 5);

    const pageIds = Array.from(
      new Set(
        [currentPage?.pageId, ...reranked.map((result) => result.pageId)].filter(
          Boolean,
        ) as string[],
      ),
    );
    const pageRecords = await this.loadPageRecords(
      input.workspaceId,
      pageIds,
      input.scope,
    );

    if (currentPage) {
      pageRecords.set(currentPage.pageId, currentPage);
    }

    const imageDescriptionMaps = await this.loadImageDescriptionMaps(pageIds);
    const contextParts: string[] = [];
    const legacySources: LegacySourceItem[] = [];
    const citations: AiCitation[] = [];
    let sourceIndex = 1;

    if (currentPage) {
      const imageDescriptions = imageDescriptionMaps.get(currentPage.pageId);
      const currentContext = currentPage.content
        ? await this.buildContextText(
            currentPage,
            input.scope,
            imageDescriptions,
          )
        : (currentPage.textContent || '').slice(0, 8000);

      contextParts.push(
        `[${sourceIndex}] (Current page) ${currentPage.title}:\n${currentContext.slice(0, 8000)}`,
      );
      legacySources.push({
        title: currentPage.title,
        slugId: currentPage.slugId,
        spaceSlug: currentPage.spaceSlug,
        distance: 0,
      });
      citations.push(this.createPageCitation(currentPage));
      citations.push(
        ...(await this.collectAssetCitationsForPage(
          currentPage,
          input.scope,
          imageDescriptions,
        )),
      );
      sourceIndex++;
    }

    for (const result of reranked) {
      const page = pageRecords.get(result.pageId);
      if (!page) {
        continue;
      }
      if (currentPage && page.pageId === currentPage.pageId) {
        continue;
      }

      const imageDescriptions = imageDescriptionMaps.get(page.pageId);
      const relevantAssets = await this.selectRelevantAssetCitations(
        page,
        input.query,
        result,
        input.scope,
        imageDescriptions,
      );

      const assetHints =
        relevantAssets.length > 0
          ? `\nRelevant assets:\n${relevantAssets
              .map((asset) => this.formatCitationHint(asset))
              .join('\n')}`
          : '';

      const label =
        result.metadata?.type === 'image'
          ? '(Image)'
          : result.metadata?.type === 'diagram'
            ? '(Diagram)'
            : '(Page)';

      contextParts.push(
        `[${sourceIndex}] ${label} ${page.title}:\n${(result.chunkText || result.textContent || '').slice(0, 2500)}${assetHints}`,
      );
      legacySources.push({
        title: page.title,
        slugId: page.slugId,
        spaceSlug: page.spaceSlug,
        type: result.metadata?.type,
      });
      citations.push(this.createPageCitation(page));
      citations.push(...relevantAssets);
      sourceIndex++;
    }

    const dedupedLegacySources = this.dedupePageSources(legacySources);
    const dedupedCitations = this.dedupeCitations(citations);
    const context = contextParts.join('\n\n').trim();

    const isChinese = /[\u4e00-\u9fa5]/.test(input.query);
    const systemPrompt = isChinese
      ? '请只根据给定上下文回答问题。优先参考标记为 Current page 的内容。引用下载、预览或图片地址时，只能使用上下文里已经给出的链接；如果上下文没有提供有效链接，就明确说不知道，不要猜测 URL。信息不足时直接说明。'
      : 'Answer strictly from the provided context. Prioritize the source marked as Current page. Only use download or preview URLs that already appear in the context. If the context does not provide a valid URL, say you do not know and do not invent one.';

    const normalizedSystemPrompt = isChinese
      ? '请只根据给定上下文回答问题。优先参考标记为 Current page 的内容。如果上下文里已经出现明确的 URL、markdown 链接或 Explicit links 列表，直接返回精确链接，不要只说“点击下载”。引用下载、预览或图片地址时，只能使用上下文里已经给出的链接；如果上下文没有提供有效链接，就明确说不知道，不要猜测 URL。信息不足时直接说明。'
      : 'Answer strictly from the provided context. Prioritize the source marked as Current page. If the context already contains a concrete URL, markdown link, or explicit link list, return the exact URL directly instead of only naming the link text. Only use links that already appear in the context. If the context does not provide a valid URL, say you do not know and do not invent one.';

    const messages: any[] = [
      {
        role: 'system',
        content: `${normalizedSystemPrompt}\n\nContext:\n${context || 'No relevant context available.'}`,
      },
    ];

    if (input.history?.length) {
      for (const message of input.history) {
        messages.push({
          role: message.role,
          content: message.content,
        });
      }
    }

    const model = this.getCompletionModel();
    let result: any;
    if (input.images?.length) {
      messages.push({
        role: 'user',
        content: [
          ...input.images.map((image) => ({
            type: 'image' as const,
            image: Buffer.from(image.data, 'base64'),
            mimeType: image.mimeType,
          })),
          { type: 'text' as const, text: input.query },
        ],
      });
      result = streamText({ model, messages });
    } else {
      messages.push({ role: 'user', content: input.query });
      result = streamText({ model, messages });
    }

    yield JSON.stringify({
      sources: dedupedLegacySources,
      citations: dedupedCitations,
    });

    try {
      for await (const text of this.stripThinkBlocks(result.textStream)) {
        yield JSON.stringify({ content: text });
      }
    } catch (streamError: any) {
      const message = streamError?.message || '';
      if (
        input.images?.length &&
        (message.includes('vision') ||
          message.includes('image') ||
          message.includes('multimodal'))
      ) {
        yield JSON.stringify({
          error: isChinese
            ? '当前 AI 模型不支持图片理解，请切换到支持视觉的模型。'
            : 'The current AI model does not support image understanding.',
        });
        return;
      }
      throw streamError;
    }
  }

  /**
   * Strip <think>...</think> blocks from a streaming text generator.
   * Some models (DeepSeek, Gemini via proxy, etc.) emit reasoning tokens
   * wrapped in <think> tags that should not be shown to the user.
   * Handles tags split across multiple chunks.
   */
  private async *stripThinkBlocks(
    textStream: AsyncIterable<string>,
  ): AsyncGenerator<string> {
    let inside = false;
    let buffer = '';

    for await (const chunk of textStream) {
      buffer += chunk;
      let out = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (inside) {
          const idx = buffer.indexOf('</think>');
          if (idx === -1) {
            // Still inside think block; keep only potential partial close tag
            buffer = buffer.length > 8 ? buffer.slice(-8) : buffer;
            break;
          }
          buffer = buffer.slice(idx + 8);
          inside = false;
        } else {
          const idx = buffer.indexOf('<think>');
          if (idx !== -1) {
            out += buffer.slice(0, idx);
            buffer = buffer.slice(idx + 7);
            inside = true;
          } else {
            // Keep potential partial '<think>' at tail
            let keep = 0;
            for (let k = 1; k <= Math.min(7, buffer.length); k++) {
              if ('<think>'.startsWith(buffer.slice(-k))) {
                keep = k;
              }
            }
            out += buffer.slice(0, buffer.length - keep);
            buffer = keep ? buffer.slice(-keep) : '';
            break;
          }
        }
      }

      if (out) {
        yield out;
      }
    }

    // Flush remaining buffer if not inside a think block
    if (buffer && !inside) {
      yield buffer;
    }
  }
}
