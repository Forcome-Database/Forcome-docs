import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { sql } from 'kysely';
import { streamText } from 'ai';
import { TokenService } from '../../../core/auth/services/token.service';
import {
  QueryUnderstandingService,
  type QueryUnderstandingResult,
  type QueryIntent,
} from './query-understanding.service';
import { AnswerVerifierService } from './answer-verifier.service';
import { getIntentSystemPrompt, getLowConfidenceResponse } from '../utils/intent-prompts';
import { RetrievalQualityService, type RetrievalQualityResult } from './retrieval-quality.service';
import { WebExplorerService, type WebEvidence } from './web-explorer.service';
import {
  collectDocumentAssetProjections,
  collectDocumentAssetSources,
  collectDocumentLinkProjections,
  type DocumentAssetProjection,
  projectProsemirrorToContextText,
} from '../../../common/helpers/prosemirror/content-projection';
import { buildPublicAttachmentUrl } from '../../../core/share/share.util';
import { allocateTokenBudget } from '../utils/token-budget';

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
  origin?: string;
}

export interface AnswerWithContextInput {
  query: string;
  workspaceId: string;
  pageSlugId?: string;
  images?: AiImagePayload[];
  history?: AiChatMessage[];
  scope?: RetrievalScope;
  deepResearch?: boolean;
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
  chunkStart?: number;
  chunkLength?: number;
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
  private embeddingCache = new Map<string, { embedding: number[]; expires: number }>();
  private hasJieba: boolean | null = null;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly tokenService?: TokenService,
    private readonly queryUnderstanding?: QueryUnderstandingService,
    private readonly answerVerifier?: AnswerVerifierService,
    @Optional() private readonly retrievalQuality?: RetrievalQualityService,
    @Optional() private readonly webExplorer?: WebExplorerService,
  ) {}

  private async checkJiebaAvailable(): Promise<boolean> {
    if (this.hasJieba !== null) return this.hasJieba;
    try {
      const result = await sql<{ cnt: string }>`
        SELECT COUNT(*)::text as cnt FROM pg_ts_config WHERE cfgname = 'jiebacfg'
      `.execute(this.db);
      this.hasJieba = result.rows.length > 0 && result.rows[0].cnt !== '0';
    } catch {
      this.hasJieba = false;
    }
    return this.hasJieba;
  }

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

  /**
   * Extract heading outline from ProseMirror content for query understanding.
   * Returns a compact string like "下载地址与订阅链接 | PC端配置教程 | 安卓手机端配置教程"
   */
  private extractHeadingOutline(content: any): string | undefined {
    try {
      const doc = getProsemirrorContent(content);
      if (!doc?.content || !Array.isArray(doc.content)) return undefined;
      const headings: string[] = [];
      for (const node of doc.content) {
        if (node.type === 'heading' && node.content) {
          const text = node.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '')
            .join('')
            .trim();
          if (text) headings.push(text);
        }
      }
      return headings.length > 0 ? headings.join(' | ') : undefined;
    } catch {
      return undefined;
    }
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
      // Always use short URL (no JWT) for LLM context to avoid token waste
      // and prevent LLMs from breaking long JWT-signed URLs in their output.
      // URLs are post-processed after streaming to add JWT for public wiki.
      resolvedUrlMap.set(
        asset.attachmentId,
        this.buildAppAssetUrl(asset),
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
    if (citation.attachmentId) {
      // Use short URL (no JWT) for LLM context — URLs are post-processed
      const shortUrl = `${this.environmentService.getAppUrl()}/api/files/${citation.attachmentId}/${citation.title}`;
      return `- ${citation.title}: ${shortUrl}`;
    }
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
    const crypto = require('crypto');
    const cacheKey = crypto.createHash('md5').update(text).digest('hex');

    const cached = this.embeddingCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.embedding;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { embed } = require('ai');
    const model = this.getEmbeddingModel();
    const { embedding } = await embed({ model, value: text });

    this.embeddingCache.set(cacheKey, {
      embedding,
      expires: Date.now() + 3600_000, // 1 hour TTL
    });

    // Evict old entries if cache grows too large
    if (this.embeddingCache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of this.embeddingCache) {
        if (val.expires < now) this.embeddingCache.delete(key);
      }
    }

    return embedding;
  }

  /**
   * @deprecated Use generateDocumentContext instead — per-chunk LLM calls are
   * replaced by a single per-document call.
   */
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

  async generateDocumentContext(pageTitle: string, fullText: string): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const model = this.getLiteModel();
      const docSnippet = fullText.slice(0, 2000);

      const { text } = await generateText({
        model,
        maxTokens: 100,
        messages: [{
          role: 'user',
          content: `Summarize this document in one sentence for search context.\n\nTitle: ${pageTitle}\nContent: ${docSnippet}`,
        }],
      });

      return text?.trim() || `From document "${pageTitle}".`;
    } catch {
      return `From document "${pageTitle}".`;
    }
  }

  // ==================== Retrieval ====================

  async searchSimilarChunks(
    query: string,
    workspaceId: string,
    limit = 20,
    distanceThreshold = 0.8,
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

    const results = await this.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL hnsw.ef_search = 100`.execute(trx);
      return sql`
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
      `.execute(trx);
    });

    const rows = results.rows as any[];
    if (rows.length === 0) return [];

    const bestDistance = parseFloat(rows[0].distance);
    const adaptiveThreshold = Math.min(0.5, Math.max(0.3, bestDistance * 2.5));

    return rows
      .filter(row => parseFloat(row.distance) <= adaptiveThreshold)
      .map((row) => {
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
    // Sanitize: keep ONLY letters, digits, CJK chars, and spaces.
    // Strips all tsquery-special chars, emoji, angle brackets, quotes, etc.
    const rawQuery = query
      .trim()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawQuery) {
      return [];
    }
    const searchQuery = tsquery(rawQuery + '*');
    const scopeCondition = this.buildPageScopeCondition(scope, filters, 'p');
    const useJieba = await this.checkJiebaAvailable();

    const tsqueryExpr = useJieba
      ? sql`(to_tsquery('english', f_unaccent(${searchQuery})) || plainto_tsquery('jiebacfg', ${rawQuery}))`
      : sql`to_tsquery('english', f_unaccent(${searchQuery}))`;

    try {
      const results = await sql`
        SELECT
          p.id as "pageId",
          p.title,
          p.slug_id as "slugId",
          p.text_content as "textContent",
          s.slug as "spaceSlug",
          ts_rank(p.tsv, ${tsqueryExpr}) as rank
        FROM pages p
        JOIN spaces s ON s.id = p.space_id
        WHERE p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
          AND p.tsv @@ ${tsqueryExpr}
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
    } catch (err: any) {
      this.logger.warn(`BM25 search failed (non-blocking, vector search still active): ${err?.message}`);
      return [];
    }
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
      this.searchSimilarChunks(query, workspaceId, 20, 0.8, filters, scope),
      this.searchByBM25(query, workspaceId, 20, filters, scope),
    ]);

    const scoreMap = new Map<string, PageResult & { _bestDistance?: number }>();

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const existing = scoreMap.get(chunk.pageId);
      if (existing) {
        existing.score += 1 / (rrfK + index);
        if (chunk.distance < (existing._bestDistance ?? Infinity)) {
          existing.chunkText = chunk.chunkText;
          existing.metadata = chunk.metadata;
          existing.chunkStart = chunk.chunkStart;
          existing.chunkLength = chunk.chunkLength;
          existing._bestDistance = chunk.distance;
        }
      } else {
        scoreMap.set(chunk.pageId, {
          pageId: chunk.pageId,
          title: chunk.title,
          slugId: chunk.slugId,
          spaceSlug: chunk.spaceSlug,
          textContent: chunk.textContent,
          score: 1 / (rrfK + index),
          chunkText: chunk.chunkText,
          metadata: chunk.metadata,
          chunkStart: chunk.chunkStart,
          chunkLength: chunk.chunkLength,
          _bestDistance: chunk.distance,
        });
      }
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

    // For BM25-only results (no vector chunk), extract the most relevant text segment
    for (const [, entry] of scoreMap) {
      if (entry.chunkText || !entry.textContent) continue;
      // Split query into terms, with CJK bigram support
      let queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
      const cjkChars = query.replace(/[^\u4e00-\u9fa5]/g, '');
      if (cjkChars.length >= 2) {
        for (let i = 0; i < cjkChars.length - 1; i++) {
          queryTerms.push(cjkChars.slice(i, i + 2));
        }
      }
      if (queryTerms.length === 0) continue;

      const paragraphs = entry.textContent.split(/\n{2,}/);
      let bestPara = '';
      let bestCount = 0;
      for (const para of paragraphs) {
        const lower = para.toLowerCase();
        const count = queryTerms.filter(t => lower.includes(t)).length;
        if (count > bestCount) {
          bestCount = count;
          bestPara = para;
        }
      }
      if (bestPara) {
        const idx = entry.textContent.indexOf(bestPara);
        const start = Math.max(0, idx - 200);
        const end = Math.min(entry.textContent.length, idx + bestPara.length + 200);
        entry.chunkText = entry.textContent.slice(start, end);
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

  // ==================== Suggested Questions ====================

  private async generateSuggestedQuestions(
    query: string,
    intent: QueryIntent,
    answerPreview: string,
    currentPageTitle?: string,
    isChinese = true,
  ): Promise<string[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const model = this.getLiteModel();
      const lang = isChinese ? '中文' : 'English';
      const { text } = await generateText({
        model,
        prompt: `Based on this Q&A interaction, suggest exactly 3 natural follow-up questions a user might ask next.

Question: ${query}
Intent type: ${intent}
Answer preview: ${answerPreview.slice(0, 500)}
${currentPageTitle ? `Current page: ${currentPageTitle}` : ''}

Rules:
- Questions must be in ${lang}
- Each question should explore a different angle (deeper detail, related topic, practical application)
- Keep each question under 30 characters
- Return ONLY a JSON array of 3 strings, no markdown

Example: ["如何配置SSL证书？","有没有自动化部署方案？","这个和K8s部署有什么区别？"]`,
        maxTokens: 200,
        temperature: 0.7,
      });
      const cleaned = text
        .replace(/```json?\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length >= 1) {
        return parsed.slice(0, 3).map(String);
      }
      return [];
    } catch {
      return [];
    }
  }

  // ==================== Agentic Search ====================

  /**
   * Decompose a complex query into 2-3 focused sub-questions.
   * Only called for complexity=3 queries (Route D).
   */
  private async decomposeQuery(query: string): Promise<string[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const model = this.getLiteModel();
      const { text } = await generateText({
        model,
        prompt: `Break this complex question into 2-3 focused sub-questions that together cover the full intent. Each sub-question should be independently searchable in a knowledge base.

Question: ${query}

Return ONLY a JSON array of strings. Example: ["sub-q1", "sub-q2", "sub-q3"]`,
        maxTokens: 200,
        temperature: 0,
      });
      const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        return parsed.slice(0, 3).map(String);
      }
      return [query];
    } catch {
      return [query];
    }
  }

  /**
   * Agentic search: decompose → parallel retrieve → merge → rerank.
   * Budget: max 1 decomposition + N parallel searches.
   */
  private async agenticSearch(
    originalQuery: string,
    rewrittenQuery: string,
    workspaceId: string,
    scope?: RetrievalScope,
  ): Promise<PageResult[]> {
    const subQueries = await this.decomposeQuery(rewrittenQuery);

    // Parallel hybrid search for each sub-query
    const allResults = await Promise.all(
      subQueries.map((sq) =>
        this.hybridSearch(sq, workspaceId, 10, undefined, scope),
      ),
    );

    // Merge by pageId+chunkIndex to preserve multi-chunk evidence
    const chunkKey = (r: PageResult) => `${r.pageId}:${r.metadata?.chunkIndex ?? 0}`;
    const scoreMap = new Map<string, { result: PageResult; score: number }>();
    for (const results of allResults) {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const key = chunkKey(r);
        const existing = scoreMap.get(key);
        const score = 1 / (60 + i);
        if (existing) {
          existing.score += score;
          if (r.score > existing.result.score) {
            existing.result = r;
          }
        } else {
          scoreMap.set(key, { result: r, score });
        }
      }
    }

    // Sort by merged score descending, take top 10
    const merged = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => entry.result);

    // Rerank the merged results
    return this.rerank(rewrittenQuery, merged, 7);
  }

  // ==================== Answer With Context ====================

  async *answerWithContext(
    input: AnswerWithContextInput,
  ): AsyncGenerator<string> {
    const isChinese = /[\u4e00-\u9fa5]/.test(input.query);
    const pipelineStart = Date.now();
    const metrics: Record<string, number> = {};
    let t0 = Date.now();

    // ---- Fast-reject: skip RAG pipeline for trivial inputs ----
    const trimmedQuery = input.query.trim();
    if (trimmedQuery.length <= 2) {
      yield JSON.stringify({ intent: 'factual', complexity: 1 });
      yield JSON.stringify({ sources: [], citations: [] });
      const hint = isChinese
        ? '请输入更具体的问题，我可以帮您从知识库中查找信息。'
        : 'Please ask a more specific question so I can search the knowledge base for you.';
      yield JSON.stringify({ content: hint });
      return;
    }

    // Greeting detection (cheap regex, no LLM call)
    // Only match pure greetings with no conversation history.
    // "ok"/"thanks" excluded — they're natural acknowledgments after answers.
    const greetingPatterns = /^(你好|您好|嗨|hi|hello|hey)\s*[!！。.？?]*$/i;
    if (greetingPatterns.test(trimmedQuery) && !(input.history?.length)) {
      yield JSON.stringify({ intent: 'factual', complexity: 1 });
      yield JSON.stringify({ sources: [], citations: [] });
      const greeting = isChinese
        ? '你好！请问有什么关于知识库的问题需要我帮您查找？'
        : 'Hello! What would you like to know from the knowledge base?';
      yield JSON.stringify({ content: greeting });
      return;
    }

    const currentPage = await this.loadCurrentPage(input);

    // ---- Query Understanding (non-blocking) ----
    let understanding: QueryUnderstandingResult = {
      intent: 'factual',
      complexity: 1,
      rewrittenQuery: input.query,
      entities: [],
      searchFacets: [input.query],
      needsClarification: false,
      isOutOfScope: false,
    };

    if (this.queryUnderstanding) {
      try {
        // Use lite model for intent classification — simple structured output task,
        // completion model is wasteful here (adds cost + latency for no quality gain).
        // Fallback to completion model if lite model is not configured.
        let classifyModel: any;
        try {
          classifyModel = this.getLiteModel();
        } catch {
          classifyModel = this.getCompletionModel();
        }
        // Extract page headings as outline for better query understanding
        const pageOutline = currentPage?.content
          ? this.extractHeadingOutline(currentPage.content)
          : undefined;
        understanding = await this.queryUnderstanding.classifyAndRewrite(
          input.query,
          input.history || [],
          currentPage?.title,
          classifyModel,
          pageOutline,
        );
      } catch (err: any) {
        this.logger.warn(`Query understanding failed, using defaults: ${err?.message}`);
      }
    }

    // Deep Research mode forces agentic retrieval
    if (input.deepResearch) {
      understanding = { ...understanding, complexity: 3 as const };
    }

    // Emit intent metadata as first SSE event
    yield JSON.stringify({
      intent: understanding.intent,
      complexity: understanding.complexity,
    });

    metrics.queryUnderstanding = Date.now() - t0;
    t0 = Date.now();

    // ---- Retrieval (always runs — no short-circuits) ----
    const searchQuery = understanding.rewrittenQuery || input.query;

    let finalReranked: PageResult[];

    if (understanding.complexity === 3) {
      // Route D: Agentic — decompose + parallel search + merge
      finalReranked = await this.agenticSearch(
        input.query,
        searchQuery,
        input.workspaceId,
        input.scope,
      );
    } else {
      // Dual-path retrieval: search with both rewritten and original query
      const searchPromises: Promise<PageResult[]>[] = [
        this.hybridSearch(searchQuery, input.workspaceId, 15, undefined, input.scope),
      ];
      // If rewritten query differs from original, search both and merge
      if (searchQuery !== input.query) {
        searchPromises.push(
          this.hybridSearch(input.query, input.workspaceId, 10, undefined, input.scope),
        );
      }

      const searchResults = await Promise.all(searchPromises);
      let merged = searchResults[0];

      // Merge second path results if present
      if (searchResults.length > 1 && searchResults[1].length > 0) {
        const seen = new Set(merged.map((r) => r.pageId));
        for (const r of searchResults[1]) {
          if (!seen.has(r.pageId)) {
            merged.push(r);
            seen.add(r.pageId);
          }
        }
      }

      finalReranked = await this.rerank(searchQuery, merged, 5);
    }

    metrics.retrieval = Date.now() - t0;
    t0 = Date.now();

    // ---- Answerability Gate ----
    let qualityResult: RetrievalQualityResult = {
      confidence: 'medium',
      isPublicTopic: false,
    };

    if (this.retrievalQuality) {
      try {
        qualityResult = await this.retrievalQuality.assess(
          input.query,
          understanding.intent,
          finalReranked.map((r) => ({
            pageTitle: r.title,
            chunkText: r.chunkText || r.textContent?.slice(0, 300),
            score: r.score,
          })),
          currentPage?.title,
          this.getLiteModel(),
        );
        this.logger.debug(
          `Retrieval quality: ${qualityResult.confidence}, isPublicTopic=${qualityResult.isPublicTopic}`,
        );
      } catch {
        // Fail-open: continue with generation
      }
    }

    // LOW confidence + private topic → honest refusal
    if (qualityResult.confidence === 'low' && !qualityResult.isPublicTopic) {
      yield JSON.stringify({
        sources: this.dedupePageSources(
          currentPage
            ? [{ title: currentPage.title, slugId: currentPage.slugId, spaceSlug: currentPage.spaceSlug, distance: 0 }]
            : [],
        ),
        citations: currentPage ? [this.createPageCitation(currentPage)] : [],
      });
      yield JSON.stringify({
        content: getLowConfidenceResponse(input.query, isChinese, currentPage?.title),
      });
      try {
        const suggestions = await this.generateSuggestedQuestions(
          input.query, understanding.intent, '', currentPage?.title, isChinese,
        );
        if (suggestions.length > 0) {
          yield JSON.stringify({ suggestedQuestions: suggestions });
        }
      } catch { /* non-blocking */ }
      return;
    }

    // LOW confidence + public topic → external web exploration
    let webEvidence: WebEvidence[] = [];
    let confidenceHint = '';
    if (qualityResult.confidence === 'low' && qualityResult.isPublicTopic) {
      if (this.webExplorer) {
        try {
          this.logger.debug(`KB confidence low for public topic, exploring web: "${input.query}"`);
          webEvidence = await this.webExplorer.explore(
            understanding.rewrittenQuery || input.query,
          );
          if (webEvidence.length === 0) {
            // External search also found nothing → honest refusal
            yield JSON.stringify({
              sources: this.dedupePageSources(
                currentPage
                  ? [{ title: currentPage.title, slugId: currentPage.slugId, spaceSlug: currentPage.spaceSlug, distance: 0 }]
                  : [],
              ),
              citations: currentPage ? [this.createPageCitation(currentPage)] : [],
            });
            yield JSON.stringify({
              content: getLowConfidenceResponse(input.query, isChinese, currentPage?.title),
            });
            try {
              const suggestions = await this.generateSuggestedQuestions(
                input.query, understanding.intent, '', currentPage?.title, isChinese,
              );
              if (suggestions.length > 0) {
                yield JSON.stringify({ suggestedQuestions: suggestions });
              }
            } catch { /* non-blocking */ }
            return;
          }
          // Web evidence found — add hint about external sources
          confidenceHint = isChinese
            ? '\n\n注意：以下部分内容来自外部网络搜索（标记为 [Web]），可能不完全适用于你的具体环境。知识库原有内容标记为 [1][2] 等编号。'
            : '\n\nNote: Some content below is from external web search (marked [Web]) and may not fully apply to your specific environment. Knowledge base content is marked with [1][2] etc.';
        } catch {
          // External search failed — use cautionary hint only
          confidenceHint = isChinese
            ? '\n\n⚠️ 知识库中可能没有足够信息。如果无法从上下文找到答案，请明确说明"知识库中暂无此内容"。'
            : '\n\n⚠️ The knowledge base may not have sufficient information. If you cannot find the answer, say so explicitly.';
        }
      } else {
        // WebExplorer not available — cautionary hint only
        confidenceHint = isChinese
          ? '\n\n⚠️ 知识库中可能没有足够信息。如果无法从上下文找到答案，请明确说明"知识库中暂无此内容"。'
          : '\n\n⚠️ The knowledge base may not have sufficient information. If you cannot find the answer, say so explicitly.';
      }
    }

    metrics.answerabilityGate = Date.now() - t0;
    t0 = Date.now();

    // ---- Context Assembly ----
    const pageIds = Array.from(
      new Set(
        [currentPage?.pageId, ...finalReranked.map((result) => result.pageId)].filter(
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

    // TODO: make configurable via AI_MODEL_CONTEXT_TOKENS env var
    const budget = allocateTokenBudget(
      128000,
      4096,
      1500, // base system prompt (intent ~200 + constraints ~800 + margin)
      finalReranked.length,
      webEvidence.length,
      (input.history?.length ?? 0) > 0,
    );

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
        : (currentPage.textContent || '').slice(0, budget.currentPage);

      contextParts.push(
        `[${sourceIndex}] (Current page) ${currentPage.title}:\n${currentContext.slice(0, budget.currentPage)}`,
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

    for (const result of finalReranked) {
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
        searchQuery,
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

      // Expand chunk context: if chunk is short, include surrounding text from the page
      let chunkContent = result.chunkText || '';
      if (chunkContent.length < 800 && result.chunkStart != null && page.textContent) {
        const expandChars = Math.floor(((budget?.perChunk || 2500) - chunkContent.length) / 2);
        const start = Math.max(0, result.chunkStart - expandChars);
        const end = Math.min(
          page.textContent.length,
          result.chunkStart + (result.chunkLength || chunkContent.length) + expandChars,
        );
        chunkContent = page.textContent.slice(start, end);
      }
      if (!chunkContent) {
        chunkContent = (result.textContent || '').slice(0, budget?.perChunk || 2500);
      }

      contextParts.push(
        `[${sourceIndex}] ${label} ${page.title}:\n${chunkContent.slice(0, budget?.perChunk || 2500)}${assetHints}`,
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

    // Inject web evidence into context (clearly labeled as external)
    for (const evidence of webEvidence) {
      contextParts.push(
        `[Web] (External: ${evidence.title || evidence.url}):\n${(evidence.content || evidence.snippet || '').slice(0, Math.floor(budget.webEvidence / Math.max(webEvidence.length, 1)))}`,
      );
      citations.push({
        sourceType: 'page' as const,
        title: evidence.title || evidence.url,
        pageUrl: evidence.url,
        snippet: evidence.snippet?.slice(0, 200),
        origin: 'web',
      });
    }

    const dedupedLegacySources = this.dedupePageSources(legacySources);
    const dedupedCitations = this.dedupeCitations(citations);
    const context = contextParts.join('\n\n').trim();

    metrics.contextAssembly = Date.now() - t0;

    // ---- Intent-aware System Prompt ----
    const systemPromptText = getIntentSystemPrompt(
      understanding.intent,
      isChinese,
      context,
    ) + confidenceHint;

    const messages: any[] = [
      {
        role: 'system',
        content: systemPromptText,
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

    // ---- LLM Generation ----
    const model = this.getCompletionModel();
    let result: any;
    const wrappedQuery = `<user_query>${input.query}</user_query>`;
    if (input.images?.length) {
      messages.push({
        role: 'user',
        content: [
          ...input.images.map((image) => ({
            type: 'image' as const,
            image: Buffer.from(image.data, 'base64'),
            mimeType: image.mimeType,
          })),
          { type: 'text' as const, text: wrappedQuery },
        ],
      });
      result = streamText({ model, messages });
    } else {
      messages.push({ role: 'user', content: wrappedQuery });
      result = streamText({ model, messages });
    }

    yield JSON.stringify({
      sources: dedupedLegacySources,
      citations: dedupedCitations,
    });

    let fullAnswer = '';

    try {
      for await (const text of this.stripThinkBlocks(result.textStream)) {
        fullAnswer += text;
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

    // ---- Groundedness verification (skip for simple queries, non-blocking) ----
    if (fullAnswer.length > 100 && understanding.complexity >= 2) {
      try {
        const liteModel = this.getLiteModel();
        const verification = await this.answerVerifier?.verify(
          fullAnswer,
          context,
          liteModel,
        );
        if (verification && !verification.isGrounded && verification.ungroundedClaims.length > 0) {
          const warningMsg = isChinese
            ? `⚠️ 以下内容可能未在知识库中找到充分依据：${verification.ungroundedClaims.slice(0, 3).join('、')}`
            : `⚠️ These claims may not be fully supported: ${verification.ungroundedClaims.slice(0, 3).join(', ')}`;
          yield JSON.stringify({ warning: warningMsg });
        }
      } catch {
        // Non-blocking: silently skip verification failures
      }
    }

    // ---- Mark actually-cited sources ----
    const usedIndices = new Set<number>();
    const citationRegex = /\[(\d+)\]/g;
    let citMatch: RegExpExecArray | null;
    while ((citMatch = citationRegex.exec(fullAnswer)) !== null) {
      usedIndices.add(parseInt(citMatch[1], 10));
    }
    const hasWebRef = fullAnswer.includes('[Web]');

    if (usedIndices.size > 0 || hasWebRef) {
      const markedCitations = dedupedCitations.map((c, idx) => ({
        ...c,
        cited: c.origin === 'web' ? hasWebRef : usedIndices.has(idx + 1),
      }));
      const markedSources = dedupedLegacySources.map((s, idx) => ({
        ...s,
        cited: usedIndices.has(idx + 1),
      }));
      yield JSON.stringify({ sources: markedSources, citations: markedCitations });
    }

    // ---- Suggested Follow-up Questions (non-blocking) ----
    try {
      const suggestedQuestions = await this.generateSuggestedQuestions(
        input.query,
        understanding.intent,
        fullAnswer,
        currentPage?.title,
        isChinese,
      );
      if (suggestedQuestions.length > 0) {
        yield JSON.stringify({ suggestedQuestions });
      }
    } catch {
      // non-blocking — do not fail the response
    }

    metrics.total = Date.now() - pipelineStart;
    this.logger.log(
      `[Pipeline] intent=${understanding.intent} ` +
      `complexity=${understanding.complexity} confidence=${qualityResult.confidence} ` +
      `sources=${finalReranked.length} answerLen=${fullAnswer.length} ` +
      `timing=${JSON.stringify(metrics)}ms`,
    );
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
