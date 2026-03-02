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
    distanceThreshold = 0.8,
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
        AND (pe.embedding <=> ${embeddingStr}::vector) < ${distanceThreshold}
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
    history?: { role: string; content: string }[],
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

    // 2. 向量搜索补充上下文（带距离阈值过滤）
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
      if (currentPage && s.slugId === currentPage.slugId) continue;
      const content = (s.textContent || '').slice(0, 2000);
      contextParts.push(`[${idx}] ${s.title || 'Untitled'}:\n${content}`);
      idx++;
    }

    const context = contextParts.join('\n\n');

    // 4. Prompt 语言跟随：检测 query 是否含中文
    const isChinese = /[\u4e00-\u9fa5]/.test(query);
    const currentPageHint = currentPage
      ? (isChinese
        ? '用户正在查看标记为（当前页面）的页面，回答时优先参考该页面内容。'
        : 'The user is currently viewing the page marked as (当前页面), prioritize its content when answering.')
      : '';

    const systemPrompt = isChinese
      ? `根据以下文档内容回答用户的问题。${currentPageHint}如果文档中没有足够的信息，请如实说明。\n\n文档内容：\n${context}`
      : `Answer the following question based on the provided context from documentation pages. ${currentPageHint}If the context doesn't contain enough information, say so.\n\nContext:\n${context}`;

    // 5. 构建 messages 数组（支持多轮对话）
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history && history.length > 0) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: 'user', content: query });

    const model = this.getCompletionModel();

    let result: any;
    if (images?.length) {
      // 多模态模式：图片 + 多轮对话历史
      const userContent: any[] = [
        ...images.map((img) => ({
          type: 'image' as const,
          image: `data:${img.mimeType};base64,${img.data}`,
        })),
        { type: 'text' as const, text: query },
      ];

      // 保留历史消息，最后一条用户消息替换为多模态内容
      const imageMessages: any[] = [
        { role: 'system', content: systemPrompt },
      ];
      if (history && history.length > 0) {
        for (const msg of history) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            imageMessages.push({ role: msg.role, content: msg.content });
          }
        }
      }
      imageMessages.push({ role: 'user', content: userContent });

      result = streamText({ model, messages: imageMessages });
    } else {
      result = streamText({ model, messages });
    }

    // 6. 构建 sources 列表（当前页面放第一位）
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
