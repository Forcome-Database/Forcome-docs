import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { sql } from 'kysely';
import { streamText } from 'ai';

@Injectable()
export class AiSearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
  ) {}

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

  private getCompletionModel() {
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

  async generateEmbedding(text: string): Promise<number[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { embed } = require('ai');
    const model = this.getEmbeddingModel();
    const { embedding } = await embed({ model, value: text });
    return embedding;
  }

  async searchSimilarPages(
    query: string,
    workspaceId: string,
    limit = 5,
    filters?: { spaceId?: string; directoryId?: string; topicId?: string },
  ) {
    const queryEmbedding = await this.generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const results = await sql`
      SELECT pe.*, p.title, p.slug_id as "slugId", p.text_content as "textContent",
             s.slug as "spaceSlug",
             pe.embedding <=> ${embeddingStr}::vector AS distance
      FROM page_embeddings pe
      JOIN pages p ON p.id = pe."pageId"
      JOIN spaces s ON s.id = pe."spaceId"
      WHERE pe."workspaceId" = ${workspaceId}
        AND p.deleted_at IS NULL
        ${filters?.spaceId ? sql`AND pe."spaceId" = ${filters.spaceId}` : sql``}
        ${filters?.directoryId ? sql`AND pe."directoryId" = ${filters.directoryId}` : sql``}
        ${filters?.topicId ? sql`AND pe."topicId" = ${filters.topicId}` : sql``}
      ORDER BY distance ASC
      LIMIT ${limit}
    `.execute(this.db);

    return (results.rows as any[]).map((row) => ({
      pageId: row.pageId,
      title: row.title,
      slugId: row.slugId,
      spaceSlug: row.spaceSlug,
      textContent: row.textContent,
      distance: row.distance,
    }));
  }

  async *answerWithContext(
    query: string,
    workspaceId: string,
    pageSlugId?: string,
    images?: { data: string; mimeType: string }[],
  ): AsyncGenerator<string> {
    // 1. 如果指定了当前页面，优先获取该页面内容作为主要上下文
    let currentPage: { title: string; slugId: string; spaceSlug: string; textContent: string } | null = null;
    if (pageSlugId) {
      const rows = await sql`
        SELECT p.title, p.slug_id as "slugId", p.text_content as "textContent",
               s.slug as "spaceSlug"
        FROM pages p
        JOIN spaces s ON s.id = p.space_id
        WHERE p.slug_id = ${pageSlugId}
          AND p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
        LIMIT 1
      `.execute(this.db);
      if (rows.rows.length > 0) {
        currentPage = rows.rows[0] as any;
      }
    }

    // 2. 向量搜索补充上下文
    const sources = await this.searchSimilarPages(query, workspaceId);

    // 3. 构建上下文：当前页面优先 + 向量搜索补充（去重）
    const contextParts: string[] = [];
    let idx = 1;

    if (currentPage) {
      const content = (currentPage.textContent || '').slice(0, 4000);
      contextParts.push(`[${idx}] (当前页面) ${currentPage.title || 'Untitled'}:\n${content}`);
      idx++;
    }

    for (const s of sources) {
      // 去重：跳过当前页面
      if (currentPage && s.slugId === currentPage.slugId) continue;
      const content = (s.textContent || '').slice(0, 2000);
      contextParts.push(`[${idx}] ${s.title || 'Untitled'}:\n${content}`);
      idx++;
    }

    const context = contextParts.join('\n\n');

    const prompt = `Answer the following question based on the provided context from documentation pages.${currentPage ? ' The user is currently viewing the page marked as (当前页面), prioritize its content when answering.' : ''}

Context:
${context}

Question: ${query}

Provide a helpful and concise answer. If the context doesn't contain enough information, say so.`;

    const model = this.getCompletionModel();

    let result: any;
    if (images?.length) {
      // 多模态模式：使用 messages 格式携带图片
      const systemPrompt = `Answer the following question based on the provided context from documentation pages.${currentPage ? ' The user is currently viewing the page marked as (当前页面), prioritize its content when answering.' : ''}

Context:
${context}

Provide a helpful and concise answer. If the context doesn't contain enough information, say so.`;

      const userContent: any[] = [
        ...images.map((img) => ({
          type: 'image' as const,
          image: `data:${img.mimeType};base64,${img.data}`,
        })),
        { type: 'text' as const, text: query },
      ];

      result = streamText({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
    } else {
      result = streamText({ model, prompt });
    }

    // 构建 sources 列表（当前页面放第一位）
    const allSources: { title: string; slugId: string; spaceSlug: string }[] = [];
    if (currentPage) {
      allSources.push({ title: currentPage.title, slugId: currentPage.slugId, spaceSlug: currentPage.spaceSlug });
    }
    for (const s of sources) {
      if (currentPage && s.slugId === currentPage.slugId) continue;
      allSources.push({ title: s.title, slugId: s.slugId, spaceSlug: s.spaceSlug });
    }

    yield JSON.stringify({ sources: allSources });

    try {
      for await (const chunk of result.textStream) {
        yield JSON.stringify({ content: chunk });
      }
    } catch (streamError: any) {
      const msg = streamError?.message || '';
      if (images?.length && (msg.includes('vision') || msg.includes('image') || msg.includes('multimodal'))) {
        yield JSON.stringify({
          error: '当前 AI 模型不支持图片理解，请使用支持视觉的模型',
        });
      } else {
        throw streamError;
      }
    }
  }
}
