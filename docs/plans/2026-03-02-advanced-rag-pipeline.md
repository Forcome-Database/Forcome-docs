# 高级 RAG 检索管线实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 wiki AI 问答从"整页单向量"升级为业内最佳实践的多层检索管线：分块嵌入 + 混合搜索(BM25+Vector) + 上下文嵌入 + Rerank + 多模态图片/图表索引。

**Architecture:** 页面保存时按 ~400 token 分块（代码块不可分割），用轻量 LLM 为每个 chunk 添加文档级上下文前缀后生成 embedding；同时提取图片描述（VLM → 缓存到 attachments.textContent）和 Drawio/Excalidraw 文本（从附件文件通过 StorageService 读取解析）作为独立 chunk。检索时 BM25（pg_jieba 中文分词）和向量搜索并行执行，RRF 融合到 page 级别后由专用 Rerank 模型精排（未配置时 LLM fallback），最终 top-5 结果送入 LLM 生成回答。

**Tech Stack:** NestJS + Kysely + pgvector (HNSW) + PostgreSQL tsvector (pg_jieba) + Vercel AI SDK + BullMQ + OpenAI-compatible Rerank API + StorageService (local/S3)

---

## 设计决策记录

| # | 问题 | 决策 |
|---|------|------|
| Q1 | 中文分词 | 安装 pg_jieba，tsvector 双语（english + jiebacfg） |
| Q2 | Rerank 接口 | `AI_RERANK_MODEL` + `AI_RERANK_API_URL`(可选)，OpenAI-compatible |
| Q3 | 搜索粒度 | 向量 chunk→page 聚合，BM25 page 级，RRF page 级融合 |
| Q4 | 上下文嵌入成本 | cheapest model 生成前缀，仅增量 |
| Q5 | 图片队列策略 | 同一 job 顺序执行，图片失败不阻塞文本 |
| Q6 | 查询延迟 | 接受 3~5s 首 token，全管线串行 |
| Q7 | 多模态环境变量 | VLM 复用 completion model，Rerank 独立 |
| Q8 | 图片描述缓存 | 缓存到 attachments.textContent |
| Q9 | Drawio/Excalidraw | 数据在附件文件中，通过 StorageService.read() 读取 |
| Q10 | Rerank 降级 | 未配置时 LLM rerank fallback |
| Q11 | 图表文本提取 | 始终启用 |
| Q12 | 旧 embedding 迁移 | 手动重新激活全量重建 |
| Q13 | Embed 节点 | 不索引 |
| Q14 | 代码块分块 | 不可分割单元 |

## 降级矩阵

| 组件 | 未配置/失败时 | 行为 |
|------|-------------|------|
| AI_RERANK_MODEL | 用 AI_COMPLETION_MODEL 做 LLM rerank | 功能不变，速度稍慢 |
| VLM (图片描述) | 静默跳过图片 embedding | 图片不可检索，文本/图表正常 |
| pg_jieba | 中文 BM25 失效，靠向量搜索 | 英文 BM25 正常 |
| 上下文前缀 LLM | 用模板 `"本段来自《{title}》"` | 效果降低但不报错 |
| 附件文件不存在 | 跳过该图片/图表 | 日志 warn |

---

## Task 1: 文本分块工具函数

**Files:**
- Create: `apps/server/src/ee/ai/utils/chunker.ts`

**Step 1: 创建文件**

```typescript
// apps/server/src/ee/ai/utils/chunker.ts

export interface TextChunk {
  text: string;
  chunkIndex: number;
  chunkStart: number;
  chunkLength: number;
}

/**
 * 标记代码块边界使其在分块时不被切割
 */
function segmentByCodeBlocks(text: string): { text: string; splittable: boolean }[] {
  const codeBlockRegex = /```[\s\S]*?```/g;
  const segments: { text: string; splittable: boolean }[] = [];
  let lastEnd = 0;

  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ text: text.slice(lastEnd, match.index), splittable: true });
    }
    segments.push({ text: match[0], splittable: false });
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < text.length) {
    segments.push({ text: text.slice(lastEnd), splittable: true });
  }

  return segments.length > 0 ? segments : [{ text, splittable: true }];
}

/**
 * 在可分割文本中按句子边界分块
 */
function splitAtSentenceBoundary(text: string, maxChars: number, overlap: number): TextChunk[] {
  if (text.length <= maxChars) {
    return [{ text: text.trim(), chunkIndex: 0, chunkStart: 0, chunkLength: text.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'),
        slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '),
        slice.lastIndexOf('\n'),
      );
      if (lastBreak > maxChars * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push({ text: chunkText, chunkIndex: chunks.length, chunkStart: start, chunkLength: end - start });
    }

    start = end - overlap;
    if (start >= text.length || end === text.length) break;
  }

  return chunks;
}

/**
 * 将文本按句子边界分块，代码块作为不可分割单元。
 * 目标 ~400 token（约 1600 字符），20% 重叠。
 */
export function chunkText(text: string, maxChars = 1600, overlapRatio = 0.2): TextChunk[] {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxChars) {
    return [{ text: text.trim(), chunkIndex: 0, chunkStart: 0, chunkLength: text.length }];
  }

  const overlap = Math.floor(maxChars * overlapRatio);
  const segments = segmentByCodeBlocks(text);
  const allChunks: TextChunk[] = [];
  let globalOffset = 0;

  for (const segment of segments) {
    if (segment.splittable) {
      const subChunks = splitAtSentenceBoundary(segment.text, maxChars, overlap);
      for (const sc of subChunks) {
        allChunks.push({
          text: sc.text, chunkIndex: allChunks.length,
          chunkStart: globalOffset + sc.chunkStart, chunkLength: sc.chunkLength,
        });
      }
    } else {
      const trimmed = segment.text.trim();
      if (trimmed.length > 0) {
        allChunks.push({
          text: trimmed, chunkIndex: allChunks.length,
          chunkStart: globalOffset, chunkLength: segment.text.length,
        });
      }
    }
    globalOffset += segment.text.length;
  }

  return allChunks;
}
```

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/utils/chunker.ts
git commit -m "feat(ai): add text chunking utility with code block protection"
```

---

## Task 2: ProseMirror 内容提取工具

**Files:**
- Create: `apps/server/src/ee/ai/utils/content-extractor.ts`

**Step 1: 创建文件**

```typescript
// apps/server/src/ee/ai/utils/content-extractor.ts

export interface ImageNodeInfo {
  attachmentId: string;
  src: string;
  alt?: string;
  fileName?: string;
}

export interface DiagramNodeInfo {
  type: 'drawio' | 'excalidraw';
  attachmentId: string;
  src: string;
  title?: string;
}

/** 从 ProseMirror JSON 提取所有 image 节点信息 */
export function extractImageNodes(prosemirrorJson: any): ImageNodeInfo[] {
  const images: ImageNodeInfo[] = [];
  if (!prosemirrorJson) return images;

  function traverse(node: any) {
    if (!node) return;
    if (node.type === 'image' && node.attrs?.attachmentId) {
      images.push({
        attachmentId: node.attrs.attachmentId,
        src: node.attrs.src || '',
        alt: node.attrs.alt || undefined,
        fileName: node.attrs.src?.split('/')?.pop() || undefined,
      });
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) traverse(child);
    }
  }
  traverse(prosemirrorJson);
  return images;
}

/** 从 ProseMirror JSON 提取所有 drawio/excalidraw 节点信息 */
export function extractDiagramNodes(prosemirrorJson: any): DiagramNodeInfo[] {
  const diagrams: DiagramNodeInfo[] = [];
  if (!prosemirrorJson) return diagrams;

  function traverse(node: any) {
    if (!node) return;
    if ((node.type === 'drawio' || node.type === 'excalidraw') && node.attrs?.attachmentId) {
      diagrams.push({
        type: node.type as 'drawio' | 'excalidraw',
        attachmentId: node.attrs.attachmentId,
        src: node.attrs.src || '',
        title: node.attrs.title || undefined,
      });
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) traverse(child);
    }
  }
  traverse(prosemirrorJson);
  return diagrams;
}

/** 从 Drawio XML 提取文本标签（value/label 属性） */
export function extractDrawioText(xmlData: string): string {
  if (!xmlData) return '';
  const texts: string[] = [];
  const valueRegex = /(?:value|label)="([^"]*?)"/g;
  let match: RegExpExecArray | null;
  while ((match = valueRegex.exec(xmlData)) !== null) {
    const text = match[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, '').trim();
    if (text.length > 0) texts.push(text);
  }
  return texts.join(' ');
}

/** 从 Excalidraw JSON 提取文本元素 */
export function extractExcalidrawText(jsonData: string): string {
  if (!jsonData) return '';
  try {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    return (data.elements || [])
      .filter((el: any) => el.type === 'text' && el.text)
      .map((el: any) => el.text.trim())
      .filter((t: string) => t.length > 0)
      .join(' ');
  } catch {
    return '';
  }
}
```

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/utils/content-extractor.ts
git commit -m "feat(ai): add content extractor for images, drawio, excalidraw"
```

---

## Task 3: 环境变量 — Rerank 配置

**Files:**
- Modify: `apps/server/src/integrations/environment/environment.validation.ts:148-151`
- Modify: `apps/server/src/integrations/environment/environment.service.ts:266-269`

**Step 1: 在 validation.ts 的 `OLLAMA_API_URL` 后、class 闭合 `}` 前添加**

```typescript
  @IsOptional()
  @IsString()
  AI_RERANK_MODEL: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  AI_RERANK_API_URL: string;
```

**Step 2: 在 environment.service.ts 的 `getOpenAiApiUrl()` 方法后添加**

```typescript
  getAiRerankModel(): string {
    return this.configService.get<string>('AI_RERANK_MODEL');
  }

  getAiRerankApiUrl(): string {
    return this.configService.get<string>('AI_RERANK_API_URL');
  }
```

**Step 3: Commit**

```bash
git add apps/server/src/integrations/environment/environment.validation.ts apps/server/src/integrations/environment/environment.service.ts
git commit -m "feat(ai): add AI_RERANK_MODEL and AI_RERANK_API_URL env config"
```

---

## Task 4: ai-search.service.ts 全面重构

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

这是最核心的 Task。完全重写该文件，包含以下方法：

**Step 1: 重写整个文件**

```typescript
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
        const { openai } = require('@ai-sdk/openai');
        return openai.embedding(modelName);
      }
      case 'openai-compatible': {
        const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
        const provider = createOpenAICompatible({
          baseURL: this.environmentService.getOpenAiApiUrl(),
          apiKey: this.environmentService.getOpenAiApiKey(),
          name: 'openai-compatible',
        });
        return provider.textEmbeddingModel(modelName);
      }
      case 'gemini': {
        const { google } = require('@ai-sdk/google');
        return google.textEmbeddingModel(modelName);
      }
      case 'ollama': {
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
        const { openai } = require('@ai-sdk/openai');
        return openai(modelName);
      }
      case 'openai-compatible': {
        const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
        const provider = createOpenAICompatible({
          baseURL: this.environmentService.getOpenAiApiUrl(),
          apiKey: this.environmentService.getOpenAiApiKey(),
          name: 'openai-compatible',
        });
        return provider(modelName);
      }
      case 'gemini': {
        const { google } = require('@ai-sdk/google');
        return google(modelName);
      }
      case 'ollama': {
        const { ollama } = require('ai-sdk-ollama');
        return ollama(modelName);
      }
      default:
        throw new BadRequestException(`Unsupported AI driver: ${driver}`);
    }
  }

  // ==================== Embedding ====================

  async generateEmbedding(text: string): Promise<number[]> {
    const { embed } = require('ai');
    const model = this.getEmbeddingModel();
    const { embedding } = await embed({ model, value: text });
    return embedding;
  }

  /** 用 LLM 为 chunk 生成文档级上下文前缀（Contextual Embedding） */
  async generateContextPrefix(pageTitle: string, fullText: string, chunkText: string): Promise<string> {
    try {
      const { generateText } = require('ai');
      const model = this.getCompletionModel();
      const { text } = await generateText({
        model,
        maxTokens: 80,
        messages: [{
          role: 'user',
          content: `<document title="${pageTitle}">\n${fullText.slice(0, 3000)}\n</document>\n\n<chunk>\n${chunkText.slice(0, 800)}\n</chunk>\n\n用一句话描述这个片段在文档中的位置和主题（不超过50字），格式："本段来自《XX》，讨论……"`,
        }],
      });
      return text.trim();
    } catch {
      return `本段来自《${pageTitle}》`;
    }
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
```

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): full rewrite - hybrid search, rerank, smart context, chunk-level retrieval"
```

---

## Task 5: 重构 embedding 生成管线 — ai-queue.processor.ts

**Files:**
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts`
- Modify: `apps/server/src/ee/ai/ai.module.ts` (注入 StorageService)

**Step 1: ai.module.ts 导入 StorageModule**

在 `ai.module.ts` 中 `@Module` 添加 imports（StorageModule 已全局注册，但 StorageService 需要显式注入）：

在 `ai-queue.processor.ts` 的 constructor 中添加：

```typescript
import { StorageService } from '../../integrations/storage/storage.service';

// constructor 中新增：
private readonly storageService: StorageService,
```

**Step 2: 重写 upsertPageEmbedding 及相关方法**

将 `upsertPageEmbedding` 签名改为：

```typescript
private async upsertPageEmbedding(
  pageId: string, workspaceId: string,
  text: string, pageTitle: string,
  prosemirrorContent?: any,
): Promise<void>
```

完整逻辑：
1. 删除旧 embeddings
2. chunkText(text) → 每个 chunk 调 generateContextPrefix → generateEmbedding → INSERT (metadata: {type:'text', contextPrefix})
3. extractDiagramNodes(prosemirrorContent) → 读附件文件（storageService.read(filePath)）→ extractDrawioText/extractExcalidrawText → embed → INSERT (metadata: {type:'diagram'})
4. extractImageNodes(prosemirrorContent) → 查 attachments.textContent 缓存 → 未命中则 storageService.read → base64 → VLM generateText → 缓存到 attachments.textContent → embed → INSERT (metadata: {type:'image', description})

**Step 3: 更新 generatePageEmbeddings**

新增 select `content` 列，传递给 upsertPageEmbedding：

```typescript
const page = await this.db
  .selectFrom('pages')
  .select(['id', 'title', 'textContent', 'content'])  // 新增 content
  .where('id', '=', pageId)
  .where('deletedAt', 'is', null)
  .executeTakeFirst();

// ...
await this.upsertPageEmbedding(page.id, workspaceId, text, page.title || 'Untitled', page.content);
```

同样更新 `generateWorkspaceEmbeddings`。

**Step 4: Commit**

```bash
git add apps/server/src/ee/ai/ai-queue.processor.ts apps/server/src/ee/ai/ai.module.ts
git commit -m "feat(ai): chunked embedding with contextual prefix, image captioning, diagram extraction"
```

---

## Task 6: 数据库索引优化

**Files:**
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts` — `createEmbeddingsTable()` 方法

**Step 1: 在现有索引后添加**

```typescript
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
```

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/ai-queue.processor.ts
git commit -m "feat(ai): add HNSW, chunk, and metadata indexes for page_embeddings"
```

---

## Task 7: pg_jieba 中文分词（需确认部署环境）

**Files:**
- 可能新增迁移文件: `apps/server/src/database/migrations/YYYYMMDD-pg-jieba-tsvector.ts`

**Step 1: 创建迁移文件**

```typescript
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 尝试创建 pg_jieba 扩展（如果已安装）
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pg_jieba`.execute(db);
  } catch {
    // pg_jieba 未安装，跳过中文分词升级
    return;
  }

  // 双语 tsvector trigger：english + jiebacfg
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger() RETURNS trigger AS $$
    begin
        new.tsv :=
          setweight(to_tsvector('english', f_unaccent(coalesce(new.title, ''))), 'A') ||
          setweight(to_tsvector('jiebacfg', coalesce(new.title, '')), 'A') ||
          setweight(to_tsvector('english', f_unaccent(substring(coalesce(new.text_content, ''), 1, 1000000))), 'B') ||
          setweight(to_tsvector('jiebacfg', substring(coalesce(new.text_content, ''), 1, 1000000)), 'B');
        return new;
    end;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 恢复纯 english tsvector
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger() RETURNS trigger AS $$
    begin
        new.tsv :=
          setweight(to_tsvector('english', f_unaccent(coalesce(new.title, ''))), 'A') ||
          setweight(to_tsvector('english', f_unaccent(substring(coalesce(new.text_content, ''), 1, 1000000))), 'B');
        return new;
    end;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}
```

**注意**: pg_jieba 需要在 PostgreSQL 中编译安装。Docker 环境需要定制镜像。迁移文件做了 try/catch，pg_jieba 不存在时静默跳过。

**Step 2: Commit**

```bash
git add apps/server/src/database/migrations/
git commit -m "feat(ai): add pg_jieba Chinese full-text search migration (graceful fallback)"
```

---

## Task 8: 集成测试

**Step 1:** 重启后端 `pnpm dev`

**Step 2:** Workspace Settings → 重新激活 AI Search（触发全量重建）

**Step 3:** 验证清单：

- [ ] 日志显示每页生成多条 embedding（chunk 级）
- [ ] 图片描述生成成功（或 VLM 不支持时跳过）
- [ ] Drawio/Excalidraw 文本提取正常
- [ ] attachments.textContent 被写入图片描述缓存
- [ ] 精确关键词搜索有效（BM25 命中）
- [ ] 语义模糊查询有效（向量搜索命中）
- [ ] 来源数量动态变化（0~5 个），不再固定
- [ ] 来源包含 type 标记（text/image/diagram）
- [ ] 当前页面回答使用相关段落（非前 4000 字符）
- [ ] Rerank 模型调用成功（或 LLM fallback 正常）
- [ ] 多轮对话正常
- [ ] 图片上传问答正常

**Step 4: Final Commit**

```bash
git commit -m "feat(ai): complete advanced RAG pipeline - all tasks verified"
```

---

## 架构总览

```
页面保存时（embedding 生成管线）：
┌──────────────────────────────────────────────────────────┐
│ Page: content (JSONB) + text_content (TEXT)               │
├──────────────┬──────────────────┬────────────────────────┤
│ Text Chunks  │ Image Nodes      │ Diagram Nodes          │
│ (chunker.ts) │ (extractor.ts)   │ (extractor.ts)         │
│              │                  │                        │
│ + Context    │ attachments      │ StorageService.read()  │
│   Prefix     │ .textContent     │ → extractDrawioText()  │
│   (LLM)      │ 缓存? → VLM     │ → extractExcalidrawText│
├──────────────┴──────────────────┴────────────────────────┤
│ → generateEmbedding() per chunk                           │
│ → INSERT page_embeddings (chunkIndex, metadata{type})     │
└───────────────────────────────────────────────────────────┘

查询时（检索管线）：
┌─────────────────────────┐
│      User Query          │
├────────────┬────────────┤
│ Vector     │ BM25       │  ← Promise.all 并行
│ (chunks    │ (tsvector  │
│  →page聚合)│  pg_jieba) │
├────────────┴────────────┤
│    RRF Fusion (k=60)    │  ← page 级，top-15
├─────────────────────────┤
│    Rerank               │  ← 专用模型 or LLM fallback
│    → top-5              │
├─────────────────────────┤
│ + Current Page           │  ← searchCurrentPageChunks()
│   最相关 2~3 chunks      │
├─────────────────────────┤
│    LLM Stream Answer     │  ← [N] 来源引用
│    sources{type,dist}    │
└─────────────────────────┘
```
