# Wiki AI Q&A 质量升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Wiki AI 问答从"文档搬运工"升级为"简洁的专家同事"——解决答非所问、答案冗长、检索不到三大痛点。

**Architecture:** 4 模块沿 pipeline 顺序实施：索引层（chunk context）→ 查询理解（entities/facets）→ 检索-生成衔接（五档置信度 + 标注 + HyDE/CRAG）→ 回答生成（prompt 重写 + 消歧 + 分模式推荐）。每个 Task 独立可提交，但依赖前置 Task 的接口。

**Tech Stack:** NestJS 11 + Kysely + Vercel AI SDK v6 + Vue 3 + VitePress + Redis + pgvector

**Spec:** `docs/superpowers/specs/2026-03-30-wiki-qa-quality-upgrade-design.md`

---

## Phase 1: 索引层 + 查询理解基础

### Task 1: Chunker 传递 sectionHeading

**Files:**
- Modify: `apps/server/src/ee/ai/utils/chunker.ts:107-202`

- [ ] **Step 1: 更新 TextChunk 接口 + chunkText 函数**

在 `chunker.ts` 顶部的 `TextChunk` 接口（line 1-6）中新增字段：
```typescript
export interface TextChunk {
  text: string;
  chunkIndex: number;
  chunkStart: number;
  chunkLength: number;
  sectionHeading: string;  // NEW
}
```

在 `chunkText()` 函数内：
- `splitByHeadings` 返回的 `sections` 数组中每个 section 已有 `heading` 属性
- 在遍历 sections 生成 chunks 的循环中，将当前 section 的 `heading` 赋给每个 chunk：`sectionHeading: section.heading`
- **注意 early-return 路径**（line 154-163）：`text.length <= maxChars && sections.length <= 1` 时直接返回单个 chunk，此处也必须加 `sectionHeading: sections[0]?.heading || ''`

- [ ] **Step 2: 验证 chunker 输出**

在 Node REPL 或临时脚本中验证：
```typescript
const { chunkText } = require('./apps/server/src/ee/ai/utils/chunker');
const result = chunkText('# 第一章\n内容A\n## 1.1 小节\n内容B');
console.log(result.map(c => c.sectionHeading));
// 期望: ['第一章', '1.1 小节']
```

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/ee/ai/utils/chunker.ts
git commit -m "feat(ai): pass sectionHeading through chunker pipeline"
```

---

### Task 2: Embedding Pipeline — Structural Context

**Files:**
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts:294-315`

- [ ] **Step 1: 新增 buildStructuralContext 函数**

在 `ai-queue.processor.ts` 中（或新建一个小 util），添加：

```typescript
function buildStructuralContext(
  spaceName: string,
  pageTitle: string,
  sectionHeading: string | null,
  docSummary: string,
): string {
  const parts = [`本段来自「${spaceName}」的《${pageTitle}》`];
  if (sectionHeading) {
    parts.push(`，章节「${sectionHeading}」`);
  }
  parts.push(`。${docSummary}`);
  return parts.join('');
}
```

- [ ] **Step 2: 替换 embedding 中的 contextPrefix 组装**

当前 line 299-300：
```typescript
const contextPrefix = `${pageTitle}. ${docContext}`;
const embeddingText = `${contextPrefix}\n${chunk.text}`;
```

改为：
```typescript
const contextPrefix = buildStructuralContext(spaceName, pageTitle, chunk.sectionHeading, docContext);
const embeddingText = `${contextPrefix}\n${chunk.text}`;
```

在 `upsertPageEmbedding` 中获取 `spaceName`。当前方法已有 `page.spaceId`（line 283-287），增加 space name 查询：

```typescript
// 在 upsertPageEmbedding 方法内，page 查询之后
const space = await this.db.selectFrom('spaces')
  .select(['name'])
  .where('id', '=', page.spaceId)
  .executeTakeFirst();
const spaceName = space?.name || '';
```

- [ ] **Step 3: sectionHeading 存入 metadata**

在 INSERT 的 metadata JSON 中增加 `sectionHeading`：
```typescript
metadata: JSON.stringify({
  type: 'text',
  contextPrefix,
  chunkText: chunk.text,
  sectionHeading: chunk.sectionHeading || null,  // NEW
})
```

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/ee/ai/ai-queue.processor.ts apps/server/src/ee/ai/utils/chunker.ts
git commit -m "feat(ai): structural chunk context with space + section heading"
```

---

### Task 3: 查询理解 — entities + searchFacets

**Files:**
- Modify: `apps/server/src/ee/ai/services/query-understanding.service.ts:4-148`

- [ ] **Step 1: 扩展 QueryUnderstandingResult 接口**

在 line 13-21 的接口中增加：
```typescript
export interface QueryUnderstandingResult {
  intent: QueryIntent;
  complexity: QueryComplexity;
  rewrittenQuery: string;
  entities: string[];        // NEW
  searchFacets: string[];    // NEW
  needsClarification: boolean;
  isOutOfScope: boolean;
}
```

- [ ] **Step 2: 更新 fallback 默认值**

在 line 34-40 的 fallback 对象中：
```typescript
const fallback: QueryUnderstandingResult = {
  intent: 'factual',
  complexity: 1,
  rewrittenQuery: query,
  entities: [],              // NEW
  searchFacets: [query],     // NEW: 至少包含原始查询
  needsClarification: false,
  isOutOfScope: false,
};
```

- [ ] **Step 3: 更新 system prompt**

在 line 62-83 的 systemPrompt 中，JSON schema 部分增加：
```
- entities: array of 2-4 key business entities extracted from the query (nouns + actions)
- searchFacets: array of 2-3 synonym/alternative search phrases. Rules:
  - Always include the rewrittenQuery itself as the first element
  - Generate synonym replacements for domain-specific terms
  - Example: query "采购订单下推" → searchFacets: ["采购订单下推", "采购订单 生成下游单据", "PO下推操作"]
```

- [ ] **Step 4: 解析新字段**

在 line 130 之后（rewrittenQuery 解析之后），添加：
```typescript
const entities = Array.isArray(parsed.entities)
  ? parsed.entities.filter((e: any) => typeof e === 'string' && e.trim()).map(String)
  : [];

const searchFacets = Array.isArray(parsed.searchFacets) && parsed.searchFacets.length > 0
  ? parsed.searchFacets.filter((f: any) => typeof f === 'string' && f.trim()).map(String)
  : [rewrittenQuery];

// 确保 searchFacets 始终包含 rewrittenQuery
if (!searchFacets.includes(rewrittenQuery)) {
  searchFacets.unshift(rewrittenQuery);
}
```

在 return 语句中加入：
```typescript
return { intent, complexity, rewrittenQuery, entities, searchFacets, needsClarification: false, isOutOfScope: false };
```

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/ee/ai/services/query-understanding.service.ts
git commit -m "feat(ai): extract entities and searchFacets in query understanding"
```

---

### Task 3B: BM25 search_text 增强

**Files:**
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts`（upsertPageEmbedding 中 text_content 更新逻辑）
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`（BM25 查询，如果改 tsvector 源）

> **Spec 1.2 对应**：BM25 检索增强。不修改 `pages.text_content`（避免下游副作用），改为在 tsvector 计算时注入 spaceName + pageTitle。

- [ ] **Step 1: 在 upsertPageEmbedding 中更新 tsvector 源**

在 `upsertPageEmbedding` 方法中，当 text_content 写入 pages 表后，额外执行 tsvector 更新，将 spaceName + title 前置：

```typescript
// After text_content update, enrich tsvector with metadata
const searchableText = `${spaceName} ${pageTitle} ${text}`;
await sql`
  UPDATE pages SET tsv = to_tsvector('english', f_unaccent(${searchableText}))
  WHERE id = ${pageId}
`.execute(this.db);
```

如果项目使用 PostgreSQL trigger 自动更新 tsv，则需要改为手动更新（在 embedding 流程中覆盖 trigger 的结果）。或者修改 trigger 函数将 title 纳入 tsvector 计算。

具体方案根据现有 trigger 实现选择。核心原则：**tsv 中包含 spaceName + title 的词汇，但 text_content 列不变**。

- [ ] **Step 2: Commit**
```bash
git add apps/server/src/ee/ai/ai-queue.processor.ts
git commit -m "feat(ai): enrich BM25 tsvector with spaceName and pageTitle"
```

---

## Phase 2: 检索升级

### Task 4: 多路 Facet 搜索 + normalizedScore

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts:1443-1468`

- [ ] **Step 1: 替换 dual-path retrieval 为 multi-facet search**

将 line 1443-1468 的 dual-path retrieval 替换为：

```typescript
    } else {
      // Multi-facet retrieval: search with all facets in parallel
      const facets = understanding.searchFacets?.length > 0
        ? understanding.searchFacets.slice(0, 3) // cap at 3 facets
        : [searchQuery];

      const searchPromises = facets.map((facet, i) =>
        this.hybridSearch(facet, input.workspaceId, i === 0 ? 15 : 10, undefined, input.scope),
      );
      const searchResults = await Promise.all(searchPromises);

      // Merge all paths via RRF (reuse existing merge logic)
      let merged = searchResults[0];
      for (let pathIdx = 1; pathIdx < searchResults.length; pathIdx++) {
        const seen = new Set(merged.map((r) => r.pageId));
        for (const r of searchResults[pathIdx]) {
          if (!seen.has(r.pageId)) {
            merged.push(r);
            seen.add(r.pageId);
          }
        }
      }

      // Normalized score for threshold comparisons
      const searchPathCount = facets.length;

      finalReranked = await this.rerank(searchQuery, merged, 5);
    }
```

- [ ] **Step 2: 计算 normalizedScore（直接用局部变量）**

在多路搜索结束后（rerank 之后），直接计算 normalizedScore：
```typescript
    // searchPathCount already defined above in the facets block
    const normalizedTopScore = finalReranked.length > 0
      ? finalReranked[0].score / searchPathCount
      : 0;
```

注意：`searchPathCount` 在 `else` 分支内定义。需要将其提升到 `if/else` 之前声明为 `let searchPathCount = 1;`，在 else 分支内赋值 `searchPathCount = facets.length;`，在 if 分支（agenticSearch）内赋值 `searchPathCount = 3;`（decomposeQuery 通常生成 2-3 个子查询）。

- [ ] **Step 3: 更新 complexity=3 的 agenticSearch 输入**

当前 `agenticSearch` 的 `decomposeQuery` 只接收 rewrittenQuery。将 entities 传入以提升分解精度：

在 `agenticSearch` 方法中，修改 `decomposeQuery` 调用：
```typescript
  private async agenticSearch(
    originalQuery: string,
    rewrittenQuery: string,
    workspaceId: string,
    scope?: RetrievalScope,
    entities?: string[],  // NEW
  ): Promise<PageResult[]> {
    const entityHint = entities?.length ? `\nKey entities: ${entities.join(', ')}` : '';
    const subQueries = await this.decomposeQuery(rewrittenQuery + entityHint);
    // ... rest unchanged
  }
```

更新调用方传入 `understanding.entities`。

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): multi-facet search with normalizedScore + agenticSearch entities"
```

---

### Task 5: entityCoverage 计算 + 五档置信度

**Files:**
- Modify: `apps/server/src/ee/ai/services/retrieval-quality.service.ts` (重写)
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts` (调用方)

- [ ] **Step 1: 新增类型和 entityCoverage 函数**

在 `retrieval-quality.service.ts` 中：

替换 line 4 的类型定义：
```typescript
export type RetrievalConfidence = 'exact' | 'high' | 'partial' | 'tangential' | 'none';
```

新增导出函数：
```typescript
export function computeEntityCoverage(
  entities: string[],
  searchFacets: string[],
  topChunks: Array<{ chunkText?: string; textContent?: string }>,
): number {
  if (entities.length === 0) return 1;
  const combinedText = topChunks.slice(0, 3)
    .map(c => (c.chunkText || c.textContent || '').toLowerCase())
    .join(' ');

  const matched = entities.filter(entity => {
    const eLower = entity.toLowerCase();
    if (combinedText.includes(eLower)) return true;
    return searchFacets.some(facet =>
      facet.toLowerCase().includes(eLower) &&
      facet.toLowerCase() !== eLower &&
      combinedText.includes(facet.toLowerCase()),
    );
  });
  return matched.length / entities.length;
}
```

- [ ] **Step 2: 重写 assess 方法**

更新签名，增加 `entityCoverage` 和 `normalizedScore` 参数：

```typescript
async assess(
  query: string,
  intent: QueryIntent,
  retrievedChunks: RetrievedChunk[],
  currentPageTitle: string | undefined,
  model: any,
  entityCoverage: number,       // NEW
  normalizedScore: number,      // NEW
): Promise<RetrievalQualityResult> {
  // Fast path: no results
  if (!retrievedChunks || retrievedChunks.length === 0) {
    return { confidence: 'none', isPublicTopic: this.guessPublicTopic(query) };
  }

  // Fast path: exact match
  const simpleIntents: QueryIntent[] = ['factual', 'follow_up'];
  if (normalizedScore > 0.015 && simpleIntents.includes(intent) && entityCoverage >= 0.8) {
    return { confidence: 'exact', isPublicTopic: false };
  }

  // Fast path: high match
  if (normalizedScore > 0.012 && entityCoverage >= 0.6) {
    return { confidence: 'high', isPublicTopic: false };
  }

  // LLM assessment for borderline cases
  try {
    // ... (keep existing LLM call, update response mapping) ...
    // Map LLM output + entityCoverage to five-level:
    const llmConfidence = parsed.confidence; // 'high' | 'medium' | 'low'
    const isPublicTopic = !!parsed.isPublicTopic;

    if (llmConfidence === 'high' && entityCoverage >= 0.6) return { confidence: 'high', isPublicTopic };
    if ((llmConfidence === 'high' || llmConfidence === 'medium') && entityCoverage >= 0.4) return { confidence: 'partial', isPublicTopic };
    if (llmConfidence === 'low' && !isPublicTopic) return { confidence: 'none', isPublicTopic };
    return { confidence: 'tangential', isPublicTopic };
  } catch {
    return { confidence: 'partial', isPublicTopic: false };
  }
}
```

- [ ] **Step 3: 更新 ai-search.service.ts 调用方**

在 answerability gate 部分（约 line 1474-1499），计算 entityCoverage 并传给 assess：

```typescript
    const entityCoverage = computeEntityCoverage(
      understanding.entities,
      understanding.searchFacets,
      finalReranked.map(r => ({ chunkText: r.chunkText, textContent: r.textContent })),
    );

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
          entityCoverage,         // NEW
          normalizedTopScore,     // NEW
        );
      } catch { /* fail-open */ }
    }
```

更新 `qualityResult` 初始值类型和所有 `confidence === 'low'` 的判断改为对应的新五档。

- [ ] **Step 4: 更新 LOW confidence 路径**

当前 line 1501-1523 的 `confidence === 'low'` 判断改为 `confidence === 'none'`。

当前 line 1525-1593 的 `confidence === 'low' && isPublicTopic` 改为 `confidence === 'tangential' && isPublicTopic`（触发 web search）。非 publicTopic 的 tangential 走消歧（Task 9）。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/ee/ai/services/retrieval-quality.service.ts apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): five-level confidence with entityCoverage"
```

---

### Task 6: HyDE + CRAG Adaptive Retrieval

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

- [ ] **Step 1: 新增 HyDE 方法**

在 `ai-search.service.ts` 中新增私有方法（放在 `agenticSearch` 附近）：

```typescript
  private async hydeSearch(
    query: string,
    workspaceId: string,
    scope?: RetrievalScope,
  ): Promise<ChunkResult[]> {
    try {
      const { generateText } = require('ai');
      const model = this.getLiteModel();
      const { text: hydeAnswer } = await generateText({
        model,
        prompt: `假设知识库中有一篇文档能完美回答以下问题，这篇文档会怎么写？写一段 50-100 字的假想文档片段。\n问题：${query}`,
        maxTokens: 150,
        temperature: 0.3,
      });
      return this.searchSimilarChunks(hydeAnswer.trim(), workspaceId, 10, 0.8, undefined, scope);
    } catch {
      return [];
    }
  }
```

- [ ] **Step 2: 在 answerWithContext 中插入 HyDE 条件触发**

在 rerank 之后、answerability gate 之前（约 Task 4 新增的 normalizedTopScore 计算之后）：

```typescript
    // HyDE: if initial retrieval quality is poor, try hypothetical document embedding
    if (normalizedTopScore < 0.008 && finalReranked.length > 0) {
      const hydeChunks = await this.hydeSearch(searchQuery, input.workspaceId, input.scope);
      if (hydeChunks.length > 0) {
        // Merge HyDE results into existing
        const seen = new Set(finalReranked.map(r => r.pageId));
        for (const chunk of hydeChunks) {
          if (!seen.has(chunk.pageId)) {
            finalReranked.push({
              pageId: chunk.pageId, title: chunk.title, slugId: chunk.slugId,
              spaceSlug: chunk.spaceSlug, textContent: chunk.textContent,
              score: 0.01, chunkText: chunk.chunkText, metadata: chunk.metadata,
              chunkStart: chunk.chunkStart, chunkLength: chunk.chunkLength,
            });
            seen.add(chunk.pageId);
          }
        }
        finalReranked = await this.rerank(searchQuery, finalReranked, 5);
        // Recalculate normalized score
        normalizedTopScore = finalReranked[0]?.score / searchPathCount || 0;
      }
    }
```

- [ ] **Step 3: 新增 CRAG 修正重试**

在 answerability gate 之后（confidence 确定后），插入 CRAG 逻辑：

```typescript
    let hasRetried = false;
    if (
      !hasRetried &&
      ['partial', 'tangential'].includes(qualityResult.confidence) &&
      entityCoverage < 0.5
    ) {
      hasRetried = true;
      try {
        const { generateText } = require('ai');
        const lm = this.getLiteModel();
        const topTitle = finalReranked[0]?.title || '';
        const { text: correctedQuery } = await generateText({
          model: lm,
          prompt: `用户问"${input.query}"，但检索到的内容主要关于"${topTitle}"。生成一个更精确的搜索词来找到用户真正想要的内容。只输出搜索词，不要解释。`,
          maxTokens: 50,
          temperature: 0,
        });

        const retryResults = await this.hybridSearch(
          correctedQuery.trim(), input.workspaceId, 10, undefined, input.scope,
        );
        // Compare raw scores (both from single-path hybridSearch, so directly comparable)
        const retryRawTopScore = retryResults[0]?.score || 0;
        const originalRawTopScore = finalReranked[0]?.score || 0;
        if (retryResults.length > 0 && retryRawTopScore > originalRawTopScore * 1.5) {
          finalReranked = await this.rerank(correctedQuery.trim(), retryResults, 5);
          // Recalculate normalizedScore and entityCoverage
          const newNormalizedTopScore = finalReranked[0]?.score / searchPathCount || 0;
          entityCoverage = computeEntityCoverage(
            understanding.entities, understanding.searchFacets,
            finalReranked.map(r => ({ chunkText: r.chunkText, textContent: r.textContent })),
          );
          qualityResult = await this.retrievalQuality.assess(
            input.query, understanding.intent,
            finalReranked.map(r => ({ pageTitle: r.title, chunkText: r.chunkText || r.textContent?.slice(0, 300), score: r.score })),
            currentPage?.title, this.getLiteModel(), entityCoverage, newNormalizedTopScore,
          );
          normalizedTopScore = newNormalizedTopScore;
        }
      } catch { /* non-blocking */ }
    }
```

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): adaptive retrieval — HyDE + CRAG conditional triggers"
```

---

## Phase 3: 生成层重构

### Task 7: Prompt 架构重写

**Files:**
- Rewrite: `apps/server/src/ee/ai/utils/intent-prompts.ts`

- [ ] **Step 1: 完全重写 intent-prompts.ts**

用以下结构替换整个文件。保留 `getLowConfidenceResponse` 不变，其余全部重写：

关键导出函数签名：
```typescript
export function buildSystemPrompt(
  intent: QueryIntent,
  confidence: RetrievalConfidence,
  isChinese: boolean,
  annotatedContext: string,
): string;
```

内部结构：
- `ROLE_ZH` / `ROLE_EN`：角色定义 + 风格（"有经验的同事"）
- `getConfidenceStrategy(confidence, isChinese)`：五档回答策略
- `getFormatGuidance(intent, confidence, isChinese)`：intent × confidence 格式矩阵
- `CONSTRAINTS_ZH` / `CONSTRAINTS_EN`：引用规则 + 安全约束
- `SELF_CHECK_ZH` / `SELF_CHECK_EN`：自检指令

内容直接取 spec 文档中的完整 prompt 文本。

- [ ] **Step 2: 更新 ai-search.service.ts 的调用方**

将 line 1724-1729 的：
```typescript
const systemPromptText = getIntentSystemPrompt(understanding.intent, isChinese, context) + confidenceHint;
```
改为：
```typescript
const systemPromptText = buildSystemPrompt(
  understanding.intent,
  qualityResult.confidence,
  isChinese,
  context, // 此时 context 可能已带标注（Task 8）
) + confidenceHint;
```

更新 import 语句。

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/ee/ai/utils/intent-prompts.ts apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): rewrite prompt architecture — role + strategy + format + selfCheck"
```

---

### Task 8: 上下文相关性标注（条件触发）

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`（context assembly 部分）

- [ ] **Step 1: 新增 annotateChunkRelevance 方法**

```typescript
  private async annotateChunkRelevance(
    query: string,
    entities: string[],
    chunks: Array<{ title: string; preview: string }>,
    liteModel: any,
  ): Promise<string[]> {
    try {
      const { generateText } = require('ai');
      const chunkList = chunks.map((c, i) => `[${i + 1}] ${c.title}: ${c.preview.slice(0, 200)}`).join('\n');
      const { text } = await generateText({
        model: liteModel,
        prompt: `用户问题：${query}\n关键实体：${entities.join(', ')}\n\n以下是检索到的文档片段。对每个片段用一句话说明它与用户问题的关系：\n${chunkList}\n\n返回 JSON 数组：["片段1的关系描述", ...]`,
        maxTokens: 300,
        temperature: 0,
      });
      const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
```

- [ ] **Step 2: 条件触发标注 + 修改 context 格式**

在 context assembly 部分，contextParts 构建之前：

```typescript
    // Conditional annotation: only for partial/tangential confidence
    let annotations: string[] = [];
    if (['partial', 'tangential'].includes(qualityResult.confidence)) {
      try {
        annotations = await this.annotateChunkRelevance(
          input.query,
          understanding.entities,
          finalReranked.map(r => ({ title: r.title, preview: r.chunkText || r.textContent?.slice(0, 200) || '' })),
          this.getLiteModel(),
        );
      } catch { /* non-blocking */ }
    }
```

在 retrieved results 的 `contextParts.push` 中，如果有 annotation，使用增强格式：

```typescript
    const annotation = annotations[resultIdx] || '';
    const annotationLine = annotation ? `\n关系：${annotation}` : '';
    contextParts.push(
      `[${sourceIndex}] ${label} ${page.title}${annotationLine}\n---\n${chunkContent.slice(0, budget?.perChunk || 2500)}${assetHints}`,
    );
```

**注意 annotation 索引对齐**：context assembly 循环会跳过 currentPage（`if (currentPage && page.pageId === currentPage.pageId) continue`）。annotations 数组的索引对应 `finalReranked` 的索引，所以在循环中用一个独立的 `rerankedIdx` 计数器，每次进入循环体时递增（无论是否 skip）：

```typescript
    let rerankedIdx = -1;
    for (const result of finalReranked) {
      rerankedIdx++;
      const page = pageRecords.get(result.pageId);
      if (!page) continue;
      if (currentPage && page.pageId === currentPage.pageId) continue;

      const annotation = annotations[rerankedIdx] || '';
      // ... rest of loop
    }
```

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): conditional context annotation for partial/tangential confidence"
```

---

### Task 9: Tangential 消歧拦截

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`（answerWithContext，confidence 判定后）

- [ ] **Step 1: 在 tangential + 非 publicTopic 时拦截生成**

在 confidence 判定后、context assembly 之前，插入消歧逻辑：

```typescript
    // Tangential + non-public: disambiguation instead of LLM generation
    if (qualityResult.confidence === 'tangential' && !qualityResult.isPublicTopic) {
      // Check if this is already a follow-up to a disambiguation (max 1 round)
      const isFollowUpToDisambiguation = input.history?.some(
        (m) => m.role === 'assistant' && (m as any).isDisambiguation,
      );

      if (!isFollowUpToDisambiguation) {
        // Build disambiguation response (no LLM needed)
        const options = finalReranked.slice(0, 3).map((r, i) => {
          const page = pageRecords.get(r.pageId);
          const anno = annotations[i] || r.title;
          return `${i + 1}. **${page?.title || r.title}** — ${anno}`;
        });

        const entitiesStr = understanding.entities.join('、') || input.query.slice(0, 30);

        yield JSON.stringify({ sources: this.dedupePageSources(legacySources), citations: dedupedCitations });
        yield JSON.stringify({ disambiguation: true }); // structured flag for frontend

        const response = isChinese
          ? `知识库中没有找到"${entitiesStr}"的直接内容。\n\n找到了以下相关主题：\n${options.join('\n')}\n\n请问您需要了解哪个？或者换个关键词试试。`
          : `No direct content found for "${entitiesStr}" in the knowledge base.\n\nRelated topics:\n${options.join('\n')}\n\nWhich one do you need? Or try different keywords.`;

        yield JSON.stringify({ content: response });

        // Suggested questions in redirect mode
        try {
          const suggestions = await this.generateSuggestedQuestions(
            input.query, understanding.intent, '', currentPage?.title, isChinese, 'redirect',
          );
          if (suggestions.length > 0) yield JSON.stringify({ suggestedQuestions: suggestions });
        } catch {}
        return;
      }
      // If follow-up to disambiguation, fall through to normal generation with tangential strategy
    }
```

**前置条件：sources 构建需要提前**。当前 sources/citations 在 context assembly 中构建（line 1608+），但消歧发生在 context assembly 之前。解法：在消歧拦截点之前，构建一个**最小化的 sources 列表**：

```typescript
    // Build minimal sources for disambiguation (before full context assembly)
    const disambigSources = finalReranked.slice(0, 3).map(r => ({
      title: r.title, slugId: r.slugId, spaceSlug: r.spaceSlug,
    }));
    const disambigCitations = finalReranked.slice(0, 3).map(r =>
      this.createPageCitation(pageRecords.get(r.pageId) || r as any),
    );
```

这些在消歧响应中使用。如果不走消歧（confidence != tangential），后续的完整 context assembly 正常构建 sources/citations，覆盖这些临时值。

**后端 AiChatMessage 接口扩展**：在 `ai-search.service.ts` 的 `AiChatMessage` 接口（line 35-38）中增加：
```typescript
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isDisambiguation?: boolean;  // NEW: for second-round detection
}
```

- [ ] **Step 2: Commit**
```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): tangential disambiguation intercept — ask user instead of guessing"
```

---

### Task 10: Completeness Check + 推荐问题分模式

**Files:**
- Modify: `apps/server/src/ee/ai/services/answer-verifier.service.ts`
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`（推荐问题 + completeness）

- [ ] **Step 1: 新增 checkCompleteness 方法**

在 `answer-verifier.service.ts` 中：

```typescript
  checkCompleteness(
    answer: string,
    entities: string[],
  ): { isComplete: boolean; missingEntities: string[] } {
    if (entities.length === 0) return { isComplete: true, missingEntities: [] };
    const answerLower = answer.toLowerCase();
    const missing = entities.filter(e => !answerLower.includes(e.toLowerCase()));
    return { isComplete: missing.length === 0, missingEntities: missing };
  }
```

- [ ] **Step 2: 在 pipeline 末尾调用 completeness check**

在 groundedness check 之后（约 line 1755），新增：

```typescript
    // Completeness check (no LLM, pure string match)
    if (understanding.entities.length > 0 && fullAnswer.length > 50) {
      const completeness = this.answerVerifier?.checkCompleteness(fullAnswer, understanding.entities);
      if (completeness && !completeness.isComplete && completeness.missingEntities.length > 0) {
        const missingStr = completeness.missingEntities.join('、');
        const warning = isChinese
          ? `ℹ️ 关于「${missingStr}」方面，知识库中暂无相关内容。`
          : `ℹ️ No content found for: ${completeness.missingEntities.join(', ')}`;
        yield JSON.stringify({ warning });
      }
    }
```

- [ ] **Step 3: 推荐问题分 3 模式**

修改 `generateSuggestedQuestions` 签名，增加 `mode` 参数：

```typescript
  private async generateSuggestedQuestions(
    query: string,
    intent: QueryIntent,
    answerPreview: string,
    currentPageTitle?: string,
    isChinese = true,
    mode: 'explore' | 'refine' | 'redirect' = 'explore',  // NEW
  ): Promise<string[]> {
```

根据 mode 调整 prompt：

```typescript
    const modeInstruction = mode === 'explore'
      ? `基于回答内容，建议 3 个深入探索的方向（不同角度）`
      : mode === 'refine'
        ? `用户的问题中有些方面未被回答。建议 3 个更精确的搜索词来找到缺失的信息`
        : `知识库中没有用户要找的内容。建议 3 个最可能的替代搜索词或相关主题名称`;
```

- [ ] **Step 4: 在 answerWithContext 中传入 mode**

根据 confidence 决定 mode：
```typescript
    const suggestionMode = qualityResult.confidence === 'exact' || qualityResult.confidence === 'high'
      ? 'explore'
      : qualityResult.confidence === 'partial' ? 'refine' : 'redirect';

    const suggestedQuestions = await this.generateSuggestedQuestions(
      input.query, understanding.intent, fullAnswer, currentPage?.title, isChinese, suggestionMode,
    );
```

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/ee/ai/services/answer-verifier.service.ts apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): completeness check + 3-mode suggested questions"
```

---

## Phase 4: 前端适配

### Task 11: 前端消歧 + disambiguation 事件支持

**Files:**
- Modify: `wiki/docs/.vitepress/theme/types/index.ts`
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`
- Modify: `wiki/docs/.vitepress/theme/services/docmost.ts`

- [ ] **Step 1: 扩展类型定义**

在 `types/index.ts` 的 `ChatMessage` 接口（line 120-138）中增加：
```typescript
  isDisambiguation?: boolean;   // NEW: marks this message as a disambiguation prompt
```

在 `DocmostAiStreamEvent` 接口（line 392-404）中增加：
```typescript
  disambiguation?: boolean;     // NEW: server signals this is a disambiguation response
```

在 `AiHistoryMessage` 接口（line 165-168）中增加：
```typescript
  isDisambiguation?: boolean;   // NEW: passed back to server for follow-up detection
```

- [ ] **Step 2: AIChat.vue 处理 disambiguation 事件**

在 SSE 事件处理循环中（sendMessage 函数内），添加 disambiguation 处理：

```typescript
        if (event.disambiguation) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = { ...currentMsg, isDisambiguation: true }
        }
```

- [ ] **Step 3: buildHistory 传递 isDisambiguation**

在 `buildHistory()` 函数中，将 `isDisambiguation` 包含在发送给后端的 history 中：

```typescript
  const history: AiHistoryMessage[] = completed.map(msg => ({
    role: msg.role,
    content: msg.content,
    ...(msg.isDisambiguation ? { isDisambiguation: true } : {}),
  }));
```

- [ ] **Step 4: Commit**
```bash
git add wiki/docs/.vitepress/theme/types/index.ts wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/services/docmost.ts
git commit -m "feat(wiki): frontend disambiguation event support"
```

---

## Phase 5: 全量重建

### Task 12: Embedding 全量重建 Job

**Files:**
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts`

- [ ] **Step 1: 在现有 switch(job.name) 中新增 case**

当前 processor 使用 `WorkerHost` + `process(job: Job)` + `switch(job.name)` 模式（**不是** `@Process` 装饰器）。在 `process` 方法的 switch 语句中新增 case：

```typescript
case 'rebuild-all-embeddings': {
  this.logger.log('Starting full embedding rebuild...');
  const pages = await sql`
    SELECT p.id, p.workspace_id FROM pages p WHERE p.deleted_at IS NULL
  `.execute(this.db);

  const BATCH_SIZE = 5; // concurrency control
  let processed = 0;
  for (let i = 0; i < (pages.rows as any[]).length; i += BATCH_SIZE) {
    const batch = (pages.rows as any[]).slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (page: any) => {
      try {
        await this.upsertPageEmbedding(page.id, page.workspace_id);
        processed++;
      } catch (err: any) {
        this.logger.warn(`Rebuild failed for page ${page.id}: ${err?.message}`);
      }
    }));
    if (processed % 50 === 0) {
      this.logger.log(`Rebuild progress: ${processed}/${(pages.rows as any[]).length}`);
    }
  }
  this.logger.log(`Rebuild complete: ${processed}/${(pages.rows as any[]).length} pages`);
  break;
}
```

同时在 `apps/server/src/integrations/queue/constants/queue.constants.ts` 的 `QueueJob` 枚举中添加：
```typescript
REBUILD_ALL_EMBEDDINGS = 'rebuild-all-embeddings',
```

- [ ] **Step 2: 添加触发 API 或 CLI 命令**

在合适的 controller 中（如 admin AI controller）添加一个端点来触发：
```typescript
  @Post('rebuild-embeddings')
  async rebuildEmbeddings() {
    await this.aiQueue.add('rebuild-all-embeddings', {});
    return { message: 'Rebuild job queued' };
  }
```

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/ee/ai/ai-queue.processor.ts
git commit -m "feat(ai): add rebuild-all-embeddings job for full re-indexing"
```

---

## 实施顺序与依赖

```
Phase 1（基础）:
  Task 1 → Task 2 → Task 3B（串行，依赖前一步的输出）
  Task 3（可与 Task 1 并行，无依赖）

Phase 2（检索，依赖 Task 3 的 entities/searchFacets）:
  Task 4 → Task 5 → Task 6（串行）

Phase 3（生成，依赖 Phase 2 的 confidence）:
  Task 7 → Task 8 → Task 9 → Task 10（串行）

Phase 4（前端，依赖 Task 9 的消歧事件）:
  Task 11

Phase 5（重建，依赖 Task 2 的 structural context）:
  Task 12（可在 Phase 1 完成后随时执行）
```

**关键里程碑**：
- Phase 1 完成后：查询理解输出 entities/facets，可手动验证
- Phase 2 完成后：五档置信度生效，HyDE/CRAG 可观察日志
- Phase 3 完成后：新 prompt 架构 + 消歧生效，可做端到端验证
- Phase 4 完成后：前端完整支持消歧交互
- Phase 5 完成后：所有已有数据升级为新的 structural context
