// apps/server/src/ee/ai/services/ai-search.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { sql } from 'kysely';
import { streamText } from 'ai';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

interface ChunkResult {
  pageId: string; title: string; slugId: string; spaceSlug: string;
  textContent: string; distance: number;
  chunkIndex: number; chunkText?: string; metadata?: any;
}

interface PageResult {
  pageId: string; title: string; slugId: string; spaceSlug: string;
  textContent: string; score: number;
  chunkText?: string; metadata?: any;
}

interface SourceItem {
  title: string; slugId: string; spaceSlug: string;
  distance?: number; type?: string;
}

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
  ) {}

  // ==================== Model Providers ====================

  private getEmbeddingModel() {
    const driver = this.environmentService.getAiDriver();
    const modelName = this.environmentService.getAiEmbeddingModel();
    if (!driver || !modelName) {
      throw new BadRequestException('AI embedding is not configured. Please set AI_DRIVER and AI_EMBEDDING_MODEL.');
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

  /** 为 chunk 生成文档级上下文前缀（模板方式，零成本） */
  generateContextPrefix(pageTitle: string, _fullText: string, _chunkText: string): string {
    return `本段来自《${pageTitle}》`;
  }

  // ==================== 检索：Chunk 级向量搜索 ====================

  async searchSimilarChunks(
    query: string, workspaceId: string,
    limit = 20, distanceThreshold = 0.5,
    filters?: { spaceId?: string; directoryId?: string; topicId?: string },
  ): Promise<ChunkResult[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const results = await sql`
      SELECT pe."pageId", p.title, p.slug_id as "slugId",
             p.text_content as "textContent", s.slug as "spaceSlug",
             pe."chunkIndex", pe."chunkStart", pe."chunkLength", pe.metadata,
             pe.embedding <=> ${embeddingStr}::vector AS distance
      FROM page_embeddings pe
      JOIN pages p ON p.id = pe."pageId"
      JOIN spaces s ON s.id = pe."spaceId"
      WHERE pe."workspaceId" = ${workspaceId}
        AND p.deleted_at IS NULL AND pe."deletedAt" IS NULL
        AND (pe.embedding <=> ${embeddingStr}::vector) < ${distanceThreshold}
        ${filters?.spaceId ? sql`AND pe."spaceId" = ${filters.spaceId}` : sql``}
        ${filters?.directoryId ? sql`AND pe."directoryId" = ${filters.directoryId}` : sql``}
        ${filters?.topicId ? sql`AND pe."topicId" = ${filters.topicId}` : sql``}
      ORDER BY distance ASC
      LIMIT ${limit}
    `.execute(this.db);

    return (results.rows as any[]).map((row) => {
      let chunkText: string | undefined;
      if (row.chunkLength > 0 && row.textContent) {
        chunkText = row.textContent.slice(row.chunkStart, row.chunkStart + row.chunkLength);
      }
      return {
        pageId: row.pageId, title: row.title, slugId: row.slugId,
        spaceSlug: row.spaceSlug, textContent: row.textContent,
        distance: parseFloat(row.distance),
        chunkIndex: row.chunkIndex, chunkText, metadata: row.metadata,
      };
    });
  }

  // ==================== 检索：BM25 关键词搜索 ====================

  async searchByBM25(
    query: string, workspaceId: string, limit = 20,
  ): Promise<{ pageId: string; title: string; slugId: string; spaceSlug: string; textContent: string; rank: number }[]> {
    const searchQuery = tsquery(query.trim() + '*');

    const results = await sql`
      SELECT p.id as "pageId", p.title, p.slug_id as "slugId",
             p.text_content as "textContent", s.slug as "spaceSlug",
             ts_rank(p.tsv, to_tsquery('english', f_unaccent(${searchQuery}))) as rank
      FROM pages p
      JOIN spaces s ON s.id = p.space_id
      WHERE p.workspace_id = ${workspaceId}
        AND p.deleted_at IS NULL
        AND p.tsv @@ to_tsquery('english', f_unaccent(${searchQuery}))
      ORDER BY rank DESC
      LIMIT ${limit}
    `.execute(this.db);

    return (results.rows as any[]).map((row) => ({
      pageId: row.pageId, title: row.title, slugId: row.slugId,
      spaceSlug: row.spaceSlug, textContent: row.textContent,
      rank: parseFloat(row.rank),
    }));
  }

  // ==================== 混合搜索：Vector + BM25 + RRF ====================

  async hybridSearch(
    query: string, workspaceId: string, limit = 15,
    filters?: { spaceId?: string; directoryId?: string; topicId?: string },
  ): Promise<PageResult[]> {
    const RRF_K = 60;

    // 并行双路搜索
    const [chunks, bm25Results] = await Promise.all([
      this.searchSimilarChunks(query, workspaceId, 20, 0.5, filters),
      this.searchByBM25(query, workspaceId, 20),
    ]);

    // 向量结果按 pageId 聚合（保留最佳 chunk）
    const scoreMap = new Map<string, PageResult>();

    const vectorPages: string[] = [];
    for (const c of chunks) {
      if (!scoreMap.has(c.pageId)) {
        vectorPages.push(c.pageId);
        scoreMap.set(c.pageId, {
          pageId: c.pageId, title: c.title, slugId: c.slugId,
          spaceSlug: c.spaceSlug, textContent: c.textContent,
          score: 0, chunkText: c.chunkText, metadata: c.metadata,
        });
      }
    }

    // 向量 RRF 分数
    for (let i = 0; i < vectorPages.length; i++) {
      const entry = scoreMap.get(vectorPages[i])!;
      entry.score += 1 / (RRF_K + i);
    }

    // BM25 RRF 分数
    for (let i = 0; i < bm25Results.length; i++) {
      const r = bm25Results[i];
      const existing = scoreMap.get(r.pageId);
      if (existing) {
        existing.score += 1 / (RRF_K + i);
      } else {
        scoreMap.set(r.pageId, {
          pageId: r.pageId, title: r.title, slugId: r.slugId,
          spaceSlug: r.spaceSlug, textContent: r.textContent,
          score: 1 / (RRF_K + i),
        });
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ==================== Rerank（专用模型 + LLM fallback） ====================

  async rerank(query: string, candidates: PageResult[], topN = 5): Promise<PageResult[]> {
    if (candidates.length <= topN) return candidates;

    const rerankModel = this.environmentService.getAiRerankModel();

    if (rerankModel) {
      return this.rerankWithModel(query, candidates, topN, rerankModel);
    }
    return this.rerankWithLLM(query, candidates, topN);
  }

  /** 调用 OpenAI-compatible Rerank API */
  private async rerankWithModel(
    query: string, candidates: PageResult[], topN: number, modelName: string,
  ): Promise<PageResult[]> {
    try {
      const baseUrl = this.environmentService.getAiRerankApiUrl()
        || this.environmentService.getOpenAiApiUrl();
      const apiKey = this.environmentService.getOpenAiApiKey();

      const documents = candidates.slice(0, 20).map((c) =>
        (c.chunkText || c.textContent || '').slice(0, 500),
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

      const data = await response.json() as any;
      const results: PageResult[] = (data.results || [])
        .sort((a: any, b: any) => b.relevance_score - a.relevance_score)
        .slice(0, topN)
        .map((r: any) => candidates[r.index]);

      return results;
    } catch (err: any) {
      this.logger.warn(`Rerank model failed, falling back to LLM rerank: ${err?.message}`);
      return this.rerankWithLLM(query, candidates, topN);
    }
  }

  /** LLM fallback rerank */
  private async rerankWithLLM(query: string, candidates: PageResult[], topN: number): Promise<PageResult[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const model = this.getCompletionModel();

      const candidateList = candidates.slice(0, 15).map((c, i) => {
        const preview = (c.chunkText || c.textContent || '').slice(0, 300);
        return `[${i}] 《${c.title}》: ${preview}`;
      }).join('\n\n');

      const { text } = await generateText({
        model,
        maxTokens: 100,
        messages: [{
          role: 'user',
          content: `用户问题：${query}\n\n以下是候选文档，请返回与问题最相关的文档编号（最多${topN}个），按相关度从高到低，格式：数字逗号分隔如 "2,0,5"。只返回编号。\n\n${candidateList}`,
        }],
      });

      const indices = text.replace(/[^\d,]/g, '').split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 0 && n < candidates.length);

      const seen = new Set<number>();
      const reranked: PageResult[] = [];
      for (const idx of indices) {
        if (!seen.has(idx)) { seen.add(idx); reranked.push(candidates[idx]); }
        if (reranked.length >= topN) break;
      }
      // 不足时用原始排序补充
      for (const c of candidates) {
        if (!reranked.includes(c)) reranked.push(c);
        if (reranked.length >= topN) break;
      }
      return reranked;
    } catch (err: any) {
      this.logger.warn(`LLM rerank failed: ${err?.message}`);
      return candidates.slice(0, topN);
    }
  }

  // ==================== 当前页面智能截取 ====================

  async searchCurrentPageChunks(
    query: string, workspaceId: string, pageSlugId: string,
  ): Promise<{ chunkText: string; distance: number }[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const results = await sql`
      SELECT pe."chunkStart", pe."chunkLength", p.text_content as "textContent",
             pe.embedding <=> ${embeddingStr}::vector AS distance
      FROM page_embeddings pe
      JOIN pages p ON p.id = pe."pageId"
      WHERE p.slug_id = ${pageSlugId}
        AND pe."workspaceId" = ${workspaceId}
        AND p.deleted_at IS NULL AND pe."deletedAt" IS NULL
        AND (pe.metadata->>'type') = 'text'
      ORDER BY distance ASC
      LIMIT 3
    `.execute(this.db);

    return (results.rows as any[]).map((row) => ({
      chunkText: row.chunkLength > 0
        ? (row.textContent || '').slice(row.chunkStart, row.chunkStart + row.chunkLength)
        : (row.textContent || '').slice(0, 2000),
      distance: parseFloat(row.distance),
    }));
  }

  // ==================== 完整 RAG 管线：answerWithContext ====================

  async *answerWithContext(
    query: string, workspaceId: string,
    pageSlugId?: string,
    images?: { data: string; mimeType: string }[],
    history?: { role: string; content: string }[],
  ): AsyncGenerator<string> {
    // 1. 获取当前页面
    let currentPage: { title: string; slugId: string; spaceSlug: string; textContent: string } | null = null;
    if (pageSlugId) {
      const rows = await sql`
        SELECT p.title, p.slug_id as "slugId", p.text_content as "textContent", s.slug as "spaceSlug"
        FROM pages p JOIN spaces s ON s.id = p.space_id
        WHERE p.slug_id = ${pageSlugId} AND p.workspace_id = ${workspaceId} AND p.deleted_at IS NULL
        LIMIT 1
      `.execute(this.db);
      if (rows.rows.length > 0) currentPage = rows.rows[0] as any;
    }

    // 2. 混合搜索 → RRF → Rerank
    const hybridResults = await this.hybridSearch(query, workspaceId, 15);
    const reranked = await this.rerank(query, hybridResults, 5);

    // 3. 当前页面：智能 chunk 截取
    const contextParts: string[] = [];
    let idx = 1;

    if (currentPage) {
      const currentChunks = await this.searchCurrentPageChunks(query, workspaceId, currentPage.slugId);
      if (currentChunks.length > 0) {
        const relevantText = currentChunks.slice(0, 3).map((c) => c.chunkText).join('\n...\n');
        contextParts.push(`[${idx}] (当前页面) ${currentPage.title || 'Untitled'}:\n${relevantText}`);
      } else {
        contextParts.push(`[${idx}] (当前页面) ${currentPage.title || 'Untitled'}:\n${(currentPage.textContent || '').slice(0, 4000)}`);
      }
      idx++;
    }

    // 4. 重排序后的来源
    const sourceImages: { attachmentId: string; description: string }[] = [];
    for (const s of reranked) {
      if (currentPage && s.slugId === currentPage.slugId) continue;
      const content = (s.chunkText || s.textContent || '').slice(0, 2000);
      const metaType = s.metadata?.type;

      if (metaType === 'image') {
        contextParts.push(`[${idx}] (图片) ${s.title} — ${s.metadata?.description || ''}:\n${content}`);
        if (s.metadata?.attachmentId) sourceImages.push({ attachmentId: s.metadata.attachmentId, description: s.metadata.description });
      } else if (metaType === 'diagram') {
        contextParts.push(`[${idx}] (图表) ${s.title}:\n${content}`);
      } else {
        contextParts.push(`[${idx}] ${s.title || 'Untitled'}:\n${content}`);
      }
      idx++;
    }

    const context = contextParts.join('\n\n');

    // 5. System prompt
    const isChinese = /[\u4e00-\u9fa5]/.test(query);
    const currentPageHint = currentPage
      ? (isChinese ? '用户正在查看标记为（当前页面）的页面，回答时优先参考该页面内容。' : 'The user is viewing the page marked (当前页面), prioritize it.')
      : '';
    const imageHint = sourceImages.length > 0
      ? (isChinese ? '上下文中包含图片描述，如果相关请在回答中提及。' : 'Context includes image descriptions, reference if relevant.')
      : '';

    const systemPrompt = isChinese
      ? `根据以下文档内容回答用户的问题。${currentPageHint}${imageHint}如果文档中没有足够的信息，请如实说明。在回答中使用 [N] 格式引用来源编号。\n\n文档内容：\n${context}`
      : `Answer based on the provided context. ${currentPageHint}${imageHint}If insufficient info, say so. Use [N] to cite sources.\n\nContext:\n${context}`;

    // 6. Messages (多轮 + 多模态)
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    if (history?.length) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    const model = this.getCompletionModel();
    let result: any;

    if (images?.length) {
      const userContent: any[] = [
        ...images.map((img) => ({ type: 'image' as const, image: `data:${img.mimeType};base64,${img.data}` })),
        { type: 'text' as const, text: query },
      ];
      messages.push({ role: 'user', content: userContent });
      result = streamText({ model, messages });
    } else {
      messages.push({ role: 'user', content: query });
      result = streamText({ model, messages });
    }

    // 7. Sources
    const allSources: SourceItem[] = [];
    if (currentPage) {
      allSources.push({ title: currentPage.title, slugId: currentPage.slugId, spaceSlug: currentPage.spaceSlug, distance: 0 });
    }
    for (const s of reranked) {
      if (currentPage && s.slugId === currentPage.slugId) continue;
      allSources.push({ title: s.title, slugId: s.slugId, spaceSlug: s.spaceSlug, type: s.metadata?.type });
    }

    yield JSON.stringify({ sources: allSources });

    try {
      for await (const chunk of result.textStream) {
        yield JSON.stringify({ content: chunk });
      }
    } catch (streamError: any) {
      const msg = streamError?.message || '';
      if (images?.length && (msg.includes('vision') || msg.includes('image') || msg.includes('multimodal'))) {
        yield JSON.stringify({ error: '当前 AI 模型不支持图片理解，请使用支持视觉的模型' });
      } else {
        throw streamError;
      }
    }
  }
}
