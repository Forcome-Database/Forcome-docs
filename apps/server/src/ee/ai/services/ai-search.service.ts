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
  ) {
    const queryEmbedding = await this.generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const results = await sql`
      SELECT pe.*, p.title, p.slug_id as "slugId", s.slug as "spaceSlug",
             pe.embedding <=> ${embeddingStr}::vector AS distance
      FROM page_embeddings pe
      JOIN pages p ON p.id = pe."pageId"
      JOIN spaces s ON s.id = pe."spaceId"
      WHERE pe."workspaceId" = ${workspaceId}
        AND p.deleted_at IS NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `.execute(this.db);

    return (results.rows as any[]).map((row) => ({
      pageId: row.pageId,
      title: row.title,
      slugId: row.slugId,
      spaceSlug: row.spaceSlug,
      distance: row.distance,
    }));
  }

  async *answerWithContext(
    query: string,
    workspaceId: string,
  ): AsyncGenerator<string> {
    const sources = await this.searchSimilarPages(query, workspaceId);

    const context = sources
      .map((s, i) => `[${i + 1}] ${s.title || 'Untitled'}: (Page ID: ${s.pageId})`)
      .join('\n');

    const prompt = `Answer the following question based on the provided context from documentation pages.

Context:
${context}

Question: ${query}

Provide a helpful and concise answer. If the context doesn't contain enough information, say so.`;

    const model = this.getCompletionModel();
    const result = streamText({ model, prompt });

    // First yield sources
    yield JSON.stringify({
      sources: sources.map((s) => ({
        title: s.title,
        slugId: s.slugId,
        spaceSlug: s.spaceSlug,
      })),
    });

    for await (const chunk of result.textStream) {
      yield JSON.stringify({ content: chunk });
    }
  }
}
