# Wiki AI 问答助手智能化优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Wiki AI 问答从固定流水线 RAG 升级为自适应智能问答系统——理解用户意图、按需调整检索策略、适配回答风格、推荐后续问题。

**Architecture:** 在现有 `answerWithContext()` 管道前插入查询理解层（classifyAndRewrite），通过 lite model 单次调用完成意图分类+查询重写+复杂度判断，然后按路由分发到不同检索策略。回答生成阶段根据意图类型选择不同系统提示词模板。前端新增推荐问题渲染和引用 snippet 展示。

**Tech Stack:** NestJS + Kysely + Vercel AI SDK v6 (streamText/generateText) + Vue 3 + VitePress + Redis (Phase 3)

---

## File Structure

### Backend (apps/server/src/ee/ai/)

| File | Responsibility | Action |
|------|---------------|--------|
| `services/ai-search.service.ts` | RAG 主管道 | Modify: 新增 classifyAndRewrite、agenticSearch、意图适配 prompt、推荐问题生成 |
| `services/query-understanding.service.ts` | 查询理解独立模块 | Create: 意图分类、查询重写、复杂度判断、歧义检测 |
| `services/answer-verifier.service.ts` | 回答验证 | Create (P2): groundedness 检查 |
| `utils/intent-prompts.ts` | 意图适配系统提示词模板 | Create: 6 种意图对应的 system prompt |

### Frontend (wiki/docs/.vitepress/theme/)

| File | Responsibility | Action |
|------|---------------|--------|
| `types/index.ts` | 类型定义 | Modify: 新增 SSE 字段类型 |
| `services/docmost.ts` | API 服务 | Modify: 解析新 SSE 字段 |
| `components/AIChat.vue` | 主面板 | Modify: 渲染推荐问题、处理新事件 |
| `components/AIChatSources.vue` | 引用组件 | Modify: 展示 snippet 文本 |
| `components/AIChatWelcome.vue` | 欢迎页 | Modify: 动态推荐问题 |
| `components/AISuggestedQuestions.vue` | 推荐问题组件 | Create: 可复用的推荐问题按钮列 |

### Shared

| File | Responsibility | Action |
|------|---------------|--------|
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | 公共 Wiki 服务 | Modify (P3): 服务端会话存储 |

---

## Phase 0: 查询理解 + 推荐问题

### Task 1: 创建查询理解服务 — 意图分类 + 查询重写

**Files:**
- Create: `apps/server/src/ee/ai/services/query-understanding.service.ts`

**依赖**: 本 Task 独立，后续 Task 依赖它。

- [ ] **Step 1: 创建 QueryUnderstandingService 文件**

```typescript
// apps/server/src/ee/ai/services/query-understanding.service.ts
import { Injectable, Logger } from '@nestjs/common';
// NOTE: use require('ai') pattern to match codebase convention
// const { generateText } = require('ai'); — used inside methods

export type QueryIntent =
  | 'factual'        // 事实查询: "SSH 端口是多少"
  | 'procedural'     // 操作步骤: "怎么部署新版本"
  | 'conceptual'     // 概念解释: "什么是 CI/CD"
  | 'troubleshooting' // 排障诊断: "502 怎么办"
  | 'comparison'     // 对比分析: "A 和 B 哪个好"
  | 'follow_up';     // 追问细化: "详细解释一下"

export type QueryComplexity = 1 | 2 | 3;
// 1 = 简单(直答或单次RAG), 2 = 中等(增强RAG), 3 = 复杂(Agentic)

export interface QueryUnderstandingResult {
  intent: QueryIntent;
  complexity: QueryComplexity;
  rewrittenQuery: string;       // 重写后的独立查询(消解指代)
  needsClarification: boolean;  // 是否需要追问澄清
  clarificationQuestion?: string; // 追问内容
  isOutOfScope: boolean;        // 是否超出知识库范围
}

const CLASSIFY_AND_REWRITE_PROMPT = `You are a query understanding system for an enterprise knowledge base wiki.

Given a user query and optional conversation history, analyze the query and return a JSON object.

## Query Intent Types
- factual: Direct fact lookup ("What is the SSH port?")
- procedural: Step-by-step instructions ("How to deploy?")
- conceptual: Explanation of concepts ("What is CI/CD?")
- troubleshooting: Problem diagnosis ("502 error fix")
- comparison: Compare options ("A vs B")
- follow_up: Refining a previous answer

## Complexity Levels
- 1: Simple, single fact or direct lookup
- 2: Moderate, needs multiple pieces of information
- 3: Complex, cross-document reasoning or multi-step

## Rules
1. If the query contains pronouns ("it", "this", "那个") referencing conversation history, rewrite it as a self-contained query.
2. If the query is clearly outside a knowledge base scope (weather, jokes, personal), set isOutOfScope=true.
3. If the query is too vague to retrieve meaningful results, set needsClarification=true and provide a clarificationQuestion in the SAME language as the query.
4. The rewrittenQuery should always be in the same language as the original query.
5. If no rewrite needed, rewrittenQuery = original query.

Return ONLY valid JSON, no markdown fences:
{"intent":"...","complexity":1|2|3,"rewrittenQuery":"...","needsClarification":false,"clarificationQuestion":null,"isOutOfScope":false}`;

@Injectable()
export class QueryUnderstandingService {
  private readonly logger = new Logger(QueryUnderstandingService.name);

  async classifyAndRewrite(
    query: string,
    history: { role: string; content: string }[] | undefined,
    currentPageTitle: string | undefined,
    liteModel: any,
  ): Promise<QueryUnderstandingResult> {
    const userPrompt = this.buildUserPrompt(query, history, currentPageTitle);

    try {
      const { generateText } = require('ai');
      const { text } = await generateText({
        model: liteModel,
        system: CLASSIFY_AND_REWRITE_PROMPT,
        prompt: userPrompt,
        maxTokens: 300,
        temperature: 0,
      });

      return this.parseResult(text, query);
    } catch (error) {
      this.logger.warn(`Query understanding failed, using defaults: ${error}`);
      return this.defaultResult(query);
    }
  }

  private buildUserPrompt(
    query: string,
    history: { role: string; content: string }[] | undefined,
    currentPageTitle: string | undefined,
  ): string {
    let prompt = '';
    if (currentPageTitle) {
      prompt += `Current page: "${currentPageTitle}"\n`;
    }
    if (history?.length) {
      const recent = history.slice(-4); // Last 2 turns for context
      prompt += 'Recent conversation:\n';
      for (const msg of recent) {
        prompt += `${msg.role}: ${msg.content.slice(0, 200)}\n`;
      }
      prompt += '\n';
    }
    prompt += `User query: ${query}`;
    return prompt;
  }

  private parseResult(text: string, originalQuery: string): QueryUnderstandingResult {
    try {
      // Strip potential markdown fences
      const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const validIntents: QueryIntent[] = [
        'factual', 'procedural', 'conceptual',
        'troubleshooting', 'comparison', 'follow_up',
      ];
      const intent: QueryIntent = validIntents.includes(parsed.intent)
        ? parsed.intent
        : 'factual';

      const complexity: QueryComplexity =
        [1, 2, 3].includes(parsed.complexity) ? parsed.complexity : 1;

      return {
        intent,
        complexity,
        rewrittenQuery: parsed.rewrittenQuery || originalQuery,
        needsClarification: !!parsed.needsClarification,
        clarificationQuestion: parsed.clarificationQuestion || undefined,
        isOutOfScope: !!parsed.isOutOfScope,
      };
    } catch {
      return this.defaultResult(originalQuery);
    }
  }

  private defaultResult(query: string): QueryUnderstandingResult {
    return {
      intent: 'factual',
      complexity: 1,
      rewrittenQuery: query,
      needsClarification: false,
      isOutOfScope: false,
    };
  }
}
```

- [ ] **Step 2: 注册到 AI Module**

Modify: `apps/server/src/ee/ai/ai.module.ts` — 在 providers 数组添加 `QueryUnderstandingService`，在 exports 数组添加 `QueryUnderstandingService`。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/services/query-understanding.service.ts apps/server/src/ee/ai/ai.module.ts
git commit -m "feat(ai): add QueryUnderstandingService with intent classification and query rewriting"
```

---

### Task 2: 创建意图适配系统提示词模板

**Files:**
- Create: `apps/server/src/ee/ai/utils/intent-prompts.ts`

- [ ] **Step 1: 创建意图提示词模板文件**

```typescript
// apps/server/src/ee/ai/utils/intent-prompts.ts
import type { QueryIntent } from '../services/query-understanding.service';

/**
 * 基础约束（所有意图共享）
 */
const BASE_CONSTRAINTS_ZH = `请只根据给定上下文回答问题。优先参考标记为 Current page 的内容。
引用下载、预览或图片地址时，只能使用上下文里已经给出的链接。
如果上下文没有提供有效链接，就明确说不知道，不要猜测 URL。
当上下文中出现 ![...](url) 格式的图片时，请保持该格式原样输出。
在回答中使用 [1]、[2] 等编号引用上下文来源。`;

const BASE_CONSTRAINTS_EN = `Answer strictly from the provided context. Prioritize the source marked as Current page.
Only use links that already appear in the context. If no valid URL provided, say you don't know.
Preserve ![...](url) image format from context.
Use [1], [2] etc. to cite context sources in your answer.`;

/**
 * 意图特定指令
 */
const INTENT_INSTRUCTIONS: Record<QueryIntent, { zh: string; en: string }> = {
  factual: {
    zh: '用户在查找一个具体事实。请简洁直答，1-3 句话给出答案，附上来源编号。如果上下文中没有答案，直接说明。',
    en: 'User is looking for a specific fact. Answer concisely in 1-3 sentences with source citations. If not found, say so.',
  },
  procedural: {
    zh: '用户需要操作步骤。请用编号列表给出清晰的分步骤指南，每步包含具体命令或操作。如有代码，用代码块格式。',
    en: 'User needs step-by-step instructions. Use numbered list, include specific commands/actions per step. Use code blocks for code.',
  },
  conceptual: {
    zh: '用户想理解一个概念。请先用 1-2 句话给出概述，然后展开解释关键要点。由浅入深，适合不同知识水平的读者。',
    en: 'User wants to understand a concept. Start with 1-2 sentence overview, then explain key points progressively.',
  },
  troubleshooting: {
    zh: '用户遇到了问题需要排障。请给出排查思路：先列出可能原因（按可能性排序），然后对每个原因给出检查方法和解决方案。',
    en: 'User has a problem to troubleshoot. List possible causes (by likelihood), with diagnosis steps and solutions for each.',
  },
  comparison: {
    zh: '用户想对比不同选项。请用表格对比关键维度（功能、优缺点、适用场景等），最后给出总结推荐。',
    en: 'User wants to compare options. Use a table to compare key dimensions, then summarize with a recommendation.',
  },
  follow_up: {
    zh: '用户在追问上一个话题。基于已有对话深入回答，不要重复已经说过的内容。',
    en: 'User is following up on the previous topic. Go deeper without repeating what was already said.',
  },
};

/**
 * 根据意图和语言生成系统提示词
 */
export function getIntentSystemPrompt(
  intent: QueryIntent,
  isChinese: boolean,
  context: string,
): string {
  const base = isChinese ? BASE_CONSTRAINTS_ZH : BASE_CONSTRAINTS_EN;
  const instruction = isChinese
    ? INTENT_INSTRUCTIONS[intent].zh
    : INTENT_INSTRUCTIONS[intent].en;

  return `${instruction}\n\n${base}\n\nContext:\n${context || 'No relevant context available.'}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/ee/ai/utils/intent-prompts.ts
git commit -m "feat(ai): add intent-specific system prompt templates for 6 query types"
```

---

### Task 3: 集成查询理解到 answerWithContext 管道

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts:1114-1301`

这是核心改造。将 `answerWithContext` 拆分为：classifyAndRewrite → 路由 → 检索 → 意图适配回答 → 推荐问题。

- [ ] **Step 1: 在 AiSearchService 构造函数注入 QueryUnderstandingService**

在 `ai-search.service.ts` 头部 import 新模块，在构造函数参数中添加注入：

```typescript
// 新增 import (文件头部)
import { QueryUnderstandingService, type QueryUnderstandingResult, type QueryIntent } from './query-understanding.service';
import { getIntentSystemPrompt } from '../utils/intent-prompts';

// 在构造函数中注入（找到 constructor 位置，行 124-128）
// 注意：tokenService 保持 optional（?）以匹配现有签名
constructor(
  @InjectKysely() private readonly db: KyselyDB,
  private readonly environmentService: EnvironmentService,
  private readonly tokenService?: TokenService,
  private readonly queryUnderstanding?: QueryUnderstandingService, // 新增，optional 避免破坏现有注入
  private readonly answerVerifier?: AnswerVerifierService, // P2 新增
) {}
```

- [ ] **Step 2: 新增推荐问题生成方法**

在 `stripThinkBlocks` 方法之后、类末尾之前添加：

```typescript
  /**
   * Generate 3 follow-up question suggestions based on the query, intent, and answer.
   * Uses lite model, returns empty array on failure (non-blocking).
   */
  private async generateSuggestedQuestions(
    query: string,
    intent: QueryIntent,
    answerPreview: string,
    currentPageTitle?: string,
    isChinese = true,
  ): Promise<string[]> {
    try {
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

      const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length >= 1) {
        return parsed.slice(0, 3).map(String);
      }
      return [];
    } catch {
      return [];
    }
  }
```

- [ ] **Step 3: 改造 answerWithContext 方法**

替换现有的 `answerWithContext` 方法（行 1114-1301）。核心改动：
1. 先调用 `classifyAndRewrite` 获取意图+重写查询
2. 如果 `isOutOfScope`，直接回复不检索
3. 如果 `needsClarification`，直接返回追问
4. 用 `rewrittenQuery` 替代原始 `query` 做检索
5. 用 `getIntentSystemPrompt` 替代硬编码 prompt
6. 回答完成后异步生成推荐问题
7. SSE 新增 `intent` 和 `suggestedQuestions` 字段

```typescript
  async *answerWithContext(
    input: AnswerWithContextInput,
  ): AsyncGenerator<string> {
    // --- Phase 0: Query Understanding ---
    const currentPage = await this.loadCurrentPage(input);
    const liteModel = this.getLiteModel();
    const isChinese = /[\u4e00-\u9fa5]/.test(input.query);

    let understanding: QueryUnderstandingResult;
    try {
      understanding = await this.queryUnderstanding.classifyAndRewrite(
        input.query,
        input.history,
        currentPage?.title,
        liteModel,
      );
    } catch {
      understanding = {
        intent: 'factual',
        complexity: 1 as const,
        rewrittenQuery: input.query,
        needsClarification: false,
        isOutOfScope: false,
      };
    }

    // Emit intent metadata first
    yield JSON.stringify({ intent: understanding.intent, complexity: understanding.complexity });

    // Route A: Out of scope — no retrieval
    if (understanding.isOutOfScope) {
      const outOfScopeMsg = isChinese
        ? '这个问题超出了知识库的范围，我只能回答与文档内容相关的问题。请尝试换一个与文档相关的问题。'
        : 'This question is outside the knowledge base scope. I can only answer questions related to the documentation.';
      yield JSON.stringify({ content: outOfScopeMsg });
      yield JSON.stringify({
        suggestedQuestions: isChinese
          ? ['这个页面讲了什么？', '帮我总结要点', '有什么相关的文档？']
          : ['What is this page about?', 'Summarize the key points', 'Any related docs?'],
      });
      return;
    }

    // Clarification needed — ask before retrieving
    if (understanding.needsClarification && understanding.clarificationQuestion) {
      yield JSON.stringify({ content: understanding.clarificationQuestion });
      return;
    }

    // Use rewritten query for retrieval
    const searchQuery = understanding.rewrittenQuery;

    // --- Standard retrieval (Route B/C/D share the same base) ---
    const hybridResults = await this.hybridSearch(
      searchQuery,
      input.workspaceId,
      15,
      undefined,
      input.scope,
    );
    const reranked = await this.rerank(searchQuery, hybridResults, 5);

    // Route C: Enhanced RAG — retry if evidence is weak (complexity >= 2)
    let finalReranked = reranked;
    if (understanding.complexity >= 2 && reranked.length > 0) {
      const bestScore = reranked[0]?.distance ?? 1;
      if (bestScore > 0.45 && reranked.length < 3) {
        // Evidence seems weak — try an alternative query angle
        const altResults = await this.hybridSearch(
          input.query, // Try original query as supplement
          input.workspaceId,
          10,
          undefined,
          input.scope,
        );
        const altReranked = await this.rerank(input.query, altResults, 3);
        // Merge deduplicated
        const seenPageIds = new Set(finalReranked.map((r) => r.pageId));
        for (const alt of altReranked) {
          if (!seenPageIds.has(alt.pageId)) {
            finalReranked.push(alt);
            seenPageIds.add(alt.pageId);
          }
        }
        finalReranked = finalReranked.slice(0, 7);
      }
    }

    // --- Context assembly (unchanged logic, extracted to use finalReranked) ---
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
        : (currentPage.textContent || '').slice(0, 20000);

      contextParts.push(
        `[${sourceIndex}] (Current page) ${currentPage.title}:\n${currentContext.slice(0, 20000)}`,
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
      if (!page) continue;
      if (currentPage && page.pageId === currentPage.pageId) continue;

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

    // --- Answer generation with intent-specific prompt ---
    const systemPrompt = getIntentSystemPrompt(
      understanding.intent,
      isChinese,
      context,
    );

    const messages: any[] = [{ role: 'system', content: systemPrompt }];

    if (input.history?.length) {
      for (const message of input.history) {
        messages.push({ role: message.role, content: message.content });
      }
    }

    const model = this.getCompletionModel();
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
    } else {
      messages.push({ role: 'user', content: input.query });
    }

    // Emit sources and citations
    yield JSON.stringify({
      sources: dedupedLegacySources,
      citations: dedupedCitations,
    });

    // Stream LLM response
    const result = streamText({ model, messages });
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

    // --- Generate suggested follow-up questions (non-blocking) ---
    try {
      const suggestions = await this.generateSuggestedQuestions(
        input.query,
        understanding.intent,
        fullAnswer,
        currentPage?.title,
        isChinese,
      );
      if (suggestions.length > 0) {
        yield JSON.stringify({ suggestedQuestions: suggestions });
      }
    } catch {
      // Non-blocking: silently skip if suggestion generation fails
    }
  }
```

- [ ] **Step 4: 删除旧的未使用变量**

移除现在不再需要的 `normalizedSystemPrompt` 和 `systemPrompt` 旧变量（行 1231-1237）。这些已被 `getIntentSystemPrompt` 替代。

- [ ] **Step 5: 确认 generateText 使用方式**

本文件已有惯例：`streamText` 用顶层 import，`generateText` 用方法内 `require('ai')`。新增的 `generateSuggestedQuestions` 和其他方法应沿用 `const { generateText } = require('ai');` 模式，**不需要修改顶层 import**。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): integrate query understanding into answerWithContext pipeline

- classifyAndRewrite before retrieval (intent + rewrite + complexity)
- Route A: out-of-scope detection, skip retrieval
- Route B: standard RAG (unchanged)
- Route C: enhanced RAG with evidence retry for complexity >= 2
- Intent-specific system prompts for 6 query types
- Suggested follow-up questions generated after answer"
```

---

### Task 4: 前端 — SSE 新字段类型 + 推荐问题组件

**Files:**
- Modify: `wiki/docs/.vitepress/theme/types/index.ts:385-390`
- Create: `wiki/docs/.vitepress/theme/components/AISuggestedQuestions.vue`

- [ ] **Step 1: 扩展 DocmostAiStreamEvent 类型**

在 `types/index.ts:385` 修改：

```typescript
export interface DocmostAiStreamEvent {
  sources?: { title: string; slugId: string; spaceSlug: string }[]
  citations?: AiCitation[]
  content?: string
  error?: string
  // New fields from query understanding
  intent?: string
  complexity?: number
  suggestedQuestions?: string[]
}
```

- [ ] **Step 2: 在 ChatMessage 类型新增 suggestedQuestions 字段**

在 `types/index.ts` 的 `ChatMessage` interface（约行 118-134）中添加：

```typescript
  /** AI 推荐的后续问题（仅 assistant 消息） */
  suggestedQuestions?: string[]
```

- [ ] **Step 3: 创建 AISuggestedQuestions 组件**

```vue
<!-- wiki/docs/.vitepress/theme/components/AISuggestedQuestions.vue -->
<script setup lang="ts">
defineProps<{
  questions: string[]
}>()

const emit = defineEmits<{
  (e: 'ask', question: string): void
}>()
</script>

<template>
  <div v-if="questions.length > 0" class="ai-suggested-questions">
    <div class="suggested-label">你可能还想问：</div>
    <div class="suggested-list">
      <button
        v-for="(q, i) in questions"
        :key="i"
        class="suggested-btn"
        @click="emit('ask', q)"
      >
        {{ q }}
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: 添加推荐问题样式**

在 `wiki/docs/.vitepress/theme/styles/ai-chat.css` 末尾添加：

```css
/* Suggested follow-up questions */
.ai-suggested-questions {
  margin-top: var(--spacing-3);
  padding: var(--spacing-2) 0;
}

.ai-suggested-questions .suggested-label {
  font-size: 12px;
  color: var(--c-text-3);
  margin-bottom: var(--spacing-2);
}

.ai-suggested-questions .suggested-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2);
}

.ai-suggested-questions .suggested-btn {
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 16px;
  border: 1px solid var(--c-border);
  background: var(--c-bg-soft);
  color: var(--c-text-2);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.ai-suggested-questions .suggested-btn:hover {
  border-color: var(--c-brand);
  color: var(--c-brand);
  background: var(--c-bg);
}
```

- [ ] **Step 5: Commit**

```bash
git add wiki/docs/.vitepress/theme/types/index.ts wiki/docs/.vitepress/theme/components/AISuggestedQuestions.vue wiki/docs/.vitepress/theme/styles/ai-chat.css
git commit -m "feat(wiki): add SSE intent/suggestedQuestions types and AISuggestedQuestions component"
```

---

### Task 5: 前端 — AIChat.vue 集成推荐问题渲染

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue:388-409`

- [ ] **Step 1: Import AISuggestedQuestions 组件**

在 AIChat.vue 的 `<script setup>` 头部添加：

```typescript
import AISuggestedQuestions from './AISuggestedQuestions.vue'
```

- [ ] **Step 2: 在 sendMessage 的 SSE 处理中添加 suggestedQuestions 字段**

在 `sendMessage` 函数的 Docmost 事件循环中（约行 388-407），在 `event.citations` 处理之后添加：

```typescript
        if (event.suggestedQuestions) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = { ...currentMsg, suggestedQuestions: event.suggestedQuestions }
        }
```

- [ ] **Step 3: 在 renderAssistantMessage 中添加推荐问题渲染**

修改 `renderAssistantMessage` 函数（约行 204），在 `AIChatSources` 渲染之后添加推荐问题渲染。

找到 `renderAssistantMessage` 的返回部分，在 `AIChatSources` 组件之后添加 `AISuggestedQuestions`：

在 `AIChat.vue` 模板的助手消息渲染区域，找到引用卡片渲染位置，其后追加：

```typescript
// 在 renderAssistantMessage 中，在 AIChatSources 之后添加：
// 找到渲染 sources/citations 的 h() 调用，紧跟其后加入：
const suggestedQuestionsVnode = msg.suggestedQuestions?.length
  ? h(AISuggestedQuestions, {
      questions: msg.suggestedQuestions,
      onAsk: (question: string) => sendMessage(question),
    })
  : null;
```

将此 vnode 添加到助手消息渲染的 children 数组中。

- [ ] **Step 4: Commit**

```bash
git add wiki/docs/.vitepress/theme/components/AIChat.vue
git commit -m "feat(wiki): render suggested follow-up questions in AI chat panel"
```

---

### Task 6: 前端 — 动态首页推荐问题

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChatWelcome.vue`

- [ ] **Step 1: 将硬编码 suggestions 改为基于页面标题的动态计算**

```vue
<script setup lang="ts">
const props = defineProps<{
  modifierKey: string
  isConfigured: boolean
  pageTitle?: string
}>()

const emit = defineEmits<{
  (e: 'ask', question: string): void
}>()

const suggestions = computed(() => {
  if (props.pageTitle) {
    return [
      `这个页面讲了什么？`,
      `帮我总结「${props.pageTitle.slice(0, 15)}」的要点`,
      '有什么相关的文档？',
    ]
  }
  return [
    '帮我找一下最近更新的文档',
    '有哪些常见问题和解决方案？',
    '这个知识库包含哪些内容？',
  ]
})
</script>
```

注意：需在 `<script setup>` 中 import `computed` from 'vue'。

- [ ] **Step 2: Commit**

```bash
git add wiki/docs/.vitepress/theme/components/AIChatWelcome.vue
git commit -m "feat(wiki): dynamic welcome suggestions based on current page title"
```

---

### Task 7: 前端 — 引用 snippet 展示增强

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChatSources.vue`

- [ ] **Step 1: 增强 normalizedItems 以包含 snippet**

在 `AIChatSources.vue` 的 `normalizedItems` computed 中，为 citations 路径添加 snippet：

```typescript
const normalizedItems = computed(() => {
  if (props.citations && props.citations.length > 0) {
    return props.citations.map((citation, index) => {
      const href =
        citation.sourceType === 'page'
          ? getPageUrl(citation)
          : citation.publicAssetUrl || getPageUrl(citation)

      const icon =
        citation.sourceType === 'attachment'
          ? '📎'
          : citation.sourceType === 'image'
            ? '🖼️'
            : citation.sourceType === 'diagram'
              ? '📐'
              : '📄'

      return {
        key: `${citation.sourceType}-${citation.attachmentId || citation.pageSlugId || citation.slugId || index}`,
        title: citation.title || 'Untitled',
        href,
        icon,
        snippet: citation.snippet || '',  // 新增
      }
    })
  }

  return (props.sources || []).map((source) => ({
    key: `${source.spaceSlug}-${source.slugId}`,
    title: source.title || 'Untitled',
    href: getPageUrl(source),
    icon: '📄',
    snippet: '',
  }))
})
```

- [ ] **Step 2: 在模板中渲染 snippet**

修改 `<template>` 中的源卡片渲染，在 `source-title` 之后添加 snippet 展示：

```html
      <a
        v-for="item in normalizedItems"
        :key="item.key"
        :href="item.href"
        target="_blank"
        rel="noopener noreferrer"
        class="ai-chat-source-card"
      >
        <span class="source-icon">{{ item.icon }}</span>
        <div class="source-content">
          <span class="source-title">{{ item.title }}</span>
          <span v-if="item.snippet" class="source-snippet">{{ item.snippet }}</span>
        </div>
      </a>
```

- [ ] **Step 3: 在 ai-chat.css 中添加 snippet 样式**

```css
.ai-chat-source-card .source-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.ai-chat-source-card .source-snippet {
  font-size: 11px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}
```

- [ ] **Step 4: Commit**

```bash
git add wiki/docs/.vitepress/theme/components/AIChatSources.vue wiki/docs/.vitepress/theme/styles/ai-chat.css
git commit -m "feat(wiki): display citation snippets in source cards"
```

---

## Phase 1: 自适应检索

### Task 8: Route D — Agentic 查询分解与并行检索

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

- [ ] **Step 1: 新增 decomposeQuery 方法**

在 `generateSuggestedQuestions` 方法附近添加：

```typescript
  /**
   * Decompose a complex query into 2-3 focused sub-questions.
   * Only called for complexity=3 queries.
   */
  private async decomposeQuery(
    query: string,
    liteModel: any,
  ): Promise<string[]> {
    try {
      const { generateText } = require('ai');
      const { text } = await generateText({
        model: liteModel,
        prompt: `Break this complex question into 2-3 focused sub-questions that together cover the full intent. Each sub-question should be independently searchable.

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
```

- [ ] **Step 2: 新增 agenticSearch 方法**

```typescript
  /**
   * Agentic search: decompose → parallel retrieve → merge.
   * Budget: max 2 retrieval rounds total.
   */
  private async agenticSearch(
    query: string,
    rewrittenQuery: string,
    workspaceId: string,
    scope?: RetrievalScope,
  ): Promise<ChunkResult[]> {
    const liteModel = this.getLiteModel();
    const subQueries = await this.decomposeQuery(rewrittenQuery, liteModel);

    // Parallel hybrid search for each sub-query
    const allResults = await Promise.all(
      subQueries.map((sq) =>
        this.hybridSearch(sq, workspaceId, 10, undefined, scope),
      ),
    );

    // Merge by pageId+chunkIndex to preserve multi-chunk evidence
    const chunkKey = (r: ChunkResult) => `${r.pageId}:${r.chunkIndex ?? 0}`;
    const scoreMap = new Map<string, { result: ChunkResult; score: number }>();
    for (const results of allResults) {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const key = chunkKey(r);
        const existing = scoreMap.get(key);
        const score = 1 / (60 + i);
        if (existing) {
          existing.score += score;
          if (r.distance < existing.result.distance) {
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
```

- [ ] **Step 3: 在 answerWithContext 中为 complexity=3 调用 agenticSearch**

在 `answerWithContext` 方法的检索部分，将现有的 hybridSearch + rerank 逻辑包装在路由判断中：

```typescript
    // --- Adaptive retrieval based on complexity ---
    let finalReranked: ChunkResult[];

    if (understanding.complexity === 3) {
      // Route D: Agentic — decompose + parallel search + merge
      finalReranked = await this.agenticSearch(
        input.query,
        searchQuery,
        input.workspaceId,
        input.scope,
      );
    } else {
      // Route B/C: Standard + optional retry
      const hybridResults = await this.hybridSearch(
        searchQuery,
        input.workspaceId,
        15,
        undefined,
        input.scope,
      );
      finalReranked = await this.rerank(searchQuery, hybridResults, 5);

      // Route C enhancement for complexity >= 2
      if (understanding.complexity >= 2 && finalReranked.length > 0) {
        const bestScore = finalReranked[0]?.distance ?? 1;
        if (bestScore > 0.45 && finalReranked.length < 3) {
          const altResults = await this.hybridSearch(
            input.query,
            input.workspaceId,
            10,
            undefined,
            input.scope,
          );
          const altReranked = await this.rerank(input.query, altResults, 3);
          const seenPageIds = new Set(finalReranked.map((r) => r.pageId));
          for (const alt of altReranked) {
            if (!seenPageIds.has(alt.pageId)) {
              finalReranked.push(alt);
              seenPageIds.add(alt.pageId);
            }
          }
          finalReranked = finalReranked.slice(0, 7);
        }
      }
    }
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): add agentic search with query decomposition and parallel retrieval

- decomposeQuery: break complex queries into 2-3 sub-questions
- agenticSearch: parallel hybrid search + RRF merge + rerank
- Route D activated for complexity=3 queries
- Budget: max 2 retrieval rounds"
```

---

### Task 9: 追问查询上下文化

**Files:**
- Modify: `apps/server/src/ee/ai/services/query-understanding.service.ts`

当前查询重写已在 Task 1 中实现，此 Task 确保追问场景的指代消解质量。

- [ ] **Step 1: 增强 CLASSIFY_AND_REWRITE_PROMPT 中的追问处理**

在 prompt 的 Rules 部分强化追问指代消解的示例：

```
## Follow-up Examples
- History: User asked "How to deploy with Docker?", AI answered about docker-compose.
  New query: "那端口怎么配?"
  → rewrittenQuery: "Docker 部署时如何配置端口？"
  → intent: "procedural", complexity: 1

- History: User asked about "A方案和B方案", AI compared them.
  New query: "第一个怎么实现?"
  → rewrittenQuery: "A方案的具体实现方式是什么？"
  → intent: "procedural", complexity: 2
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/ee/ai/services/query-understanding.service.ts
git commit -m "feat(ai): enhance follow-up query contextualization with examples"
```

---

## Phase 2: 回答质量 + 引用增强

### Task 10: Groundedness 后验证

**Files:**
- Create: `apps/server/src/ee/ai/services/answer-verifier.service.ts`
- Modify: `apps/server/src/ee/ai/ai.module.ts`

- [ ] **Step 1: 创建 AnswerVerifierService**

```typescript
// apps/server/src/ee/ai/services/answer-verifier.service.ts
import { Injectable, Logger } from '@nestjs/common';
// generateText used via require('ai') inside methods

export interface VerificationResult {
  isGrounded: boolean;
  confidence: number;      // 0-1
  ungroundedClaims: string[]; // Claims not supported by context
}

const VERIFY_PROMPT = `You are a groundedness checker. Given an AI answer and the context it was supposed to use, identify any claims in the answer that are NOT supported by the context.

Context:
{context}

Answer:
{answer}

Return JSON: {"isGrounded": true/false, "confidence": 0.0-1.0, "ungroundedClaims": ["claim1", ...]}
Only flag claims that are factually asserted but missing from context. Opinions, hedged statements ("might", "could"), and meta-statements ("I don't have info") are NOT ungrounded.`;

@Injectable()
export class AnswerVerifierService {
  private readonly logger = new Logger(AnswerVerifierService.name);

  async verify(
    answer: string,
    context: string,
    liteModel: any,
  ): Promise<VerificationResult> {
    if (answer.length < 50) {
      return { isGrounded: true, confidence: 1, ungroundedClaims: [] };
    }

    try {
      const { generateText } = require('ai');
      const prompt = VERIFY_PROMPT
        .replace('{context}', context.slice(0, 8000))
        .replace('{answer}', answer.slice(0, 3000));

      const { text } = await generateText({
        model: liteModel,
        prompt,
        maxTokens: 300,
        temperature: 0,
      });

      const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        isGrounded: !!parsed.isGrounded,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0)),
        ungroundedClaims: Array.isArray(parsed.ungroundedClaims) ? parsed.ungroundedClaims : [],
      };
    } catch {
      return { isGrounded: true, confidence: 0.5, ungroundedClaims: [] };
    }
  }
}
```

- [ ] **Step 2: 注册到 AI Module**

- [ ] **Step 3: 在 answerWithContext 中集成验证**

在 LLM 流式回答完成后、推荐问题生成前，插入验证逻辑：

```typescript
    // --- Groundedness verification (non-blocking warning) ---
    if (fullAnswer.length > 100) {
      try {
        const verification = await this.answerVerifier.verify(
          fullAnswer,
          context,
          liteModel,
        );
        if (!verification.isGrounded && verification.ungroundedClaims.length > 0) {
          const warningMsg = isChinese
            ? `⚠️ 以下内容可能未在知识库中找到依据：${verification.ungroundedClaims.join('、')}`
            : `⚠️ These claims may not be fully supported by the knowledge base: ${verification.ungroundedClaims.join(', ')}`;
          yield JSON.stringify({ warning: warningMsg });
        }
      } catch {
        // Non-blocking
      }
    }
```

- [ ] **Step 4: 前端处理 warning 事件**

在 `DocmostAiStreamEvent` 类型中添加 `warning?: string`。在 `AIChat.vue` 的 SSE 事件循环中添加 warning 处理，将其追加到助手消息内容末尾（用不同样式显示）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ee/ai/services/answer-verifier.service.ts apps/server/src/ee/ai/ai.module.ts apps/server/src/ee/ai/services/ai-search.service.ts wiki/docs/.vitepress/theme/types/index.ts wiki/docs/.vitepress/theme/components/AIChat.vue
git commit -m "feat(ai): add groundedness verification for wiki Q&A answers

- AnswerVerifierService checks claims against context
- Non-blocking warning emitted via SSE when ungrounded claims detected
- Frontend renders warning with distinct styling"
```

---

### Task 11: 引用内联 [1][2] 格式

**Files:**
- Modify: `apps/server/src/ee/ai/utils/intent-prompts.ts`

此 Task 已在 Task 2 的 BASE_CONSTRAINTS 中实现了 `[1]、[2]` 引用指令。验证效果即可，如需加强：

- [ ] **Step 1: 确认系统提示词中的引用指令生效**

测试：发送一个查询，检查 LLM 回答是否包含 `[1]`、`[2]` 等引用标记。如果模型不遵循，在 intent-prompts.ts 中强化指令：

```typescript
// 在每个 intent 的 zh 指令末尾追加：
// "请在回答中用 [1]、[2] 等编号标注信息来源。"
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/ee/ai/utils/intent-prompts.ts
git commit -m "feat(ai): reinforce inline citation [1][2] format in intent prompts"
```

---

## Phase 3: 会话 + 高级功能

### Task 12: 服务端会话存储

**Files:**
- Create: `apps/server/src/core/public-wiki/wiki-conversation.store.ts`
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`
- Modify: `apps/server/src/core/public-wiki/public-wiki.controller.ts`

复用 V2 Agent 的 Redis ConversationStore 模式，但简化为存储纯文本历史（无 PydanticAI messages）。

- [ ] **Step 1: 创建 WikiConversationStore**

```typescript
// apps/server/src/core/public-wiki/wiki-conversation.store.ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

export interface WikiConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const KEY_PREFIX = 'wiki:conv:';
const MAX_TURNS = 6;     // 6 turns = 12 messages
const MAX_BYTES = 50_000; // 50 KB hard cap
const TTL_SECONDS = 86400; // 24 hours

@Injectable()
export class WikiConversationStore {
  private readonly redis: Redis;
  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  async load(sessionId: string): Promise<WikiConversationMessage[] | null> {
    const raw = await this.redis.get(`${KEY_PREFIX}${sessionId}`);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data.messages) ? data.messages : null;
    } catch {
      return null;
    }
  }

  async save(sessionId: string, messages: WikiConversationMessage[]): Promise<void> {
    // Keep last MAX_TURNS turns
    const pruned = messages.slice(-(MAX_TURNS * 2));
    const payload = JSON.stringify({ messages: pruned });

    // Hard cap
    if (Buffer.byteLength(payload) > MAX_BYTES) {
      const minimal = pruned.slice(-4);
      const minPayload = JSON.stringify({ messages: minimal });
      await this.redis.setex(`${KEY_PREFIX}${sessionId}`, TTL_SECONDS, minPayload);
      return;
    }

    await this.redis.setex(`${KEY_PREFIX}${sessionId}`, TTL_SECONDS, payload);
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${sessionId}`);
  }
}
```

- [ ] **Step 2: 在 PublicWikiModule 中注册**

- [ ] **Step 3: 在 SSE 响应中添加 sessionId**

生成 sessionId（基于 workspaceId + requesterKey 的确定性哈希 或 UUID），第一个 SSE 事件返回 `{ sessionId }`。后续请求客户端传回 sessionId。

- [ ] **Step 4: 在前端 AIChat.vue 中存储和回传 sessionId**

收到 SSE 的 sessionId 事件后存入组件 state，后续请求通过 body 参数传回。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/public-wiki/wiki-conversation.store.ts apps/server/src/core/public-wiki/public-wiki.module.ts apps/server/src/core/public-wiki/public-wiki.service.ts apps/server/src/core/public-wiki/public-wiki.controller.ts wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/services/docmost.ts wiki/docs/.vitepress/theme/types/index.ts
git commit -m "feat(wiki): add server-side conversation store with Redis

- WikiConversationStore: Redis-backed, 6 turns, 50KB cap, 24h TTL
- Session ID returned in first SSE event
- Client stores and returns sessionId in subsequent requests
- Server loads history from Redis instead of trusting client-supplied history"
```

---

### Task 13: 歧义检测增强

**Files:**
- Modify: `apps/server/src/ee/ai/services/query-understanding.service.ts`
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

已在 Task 1 的 `classifyAndRewrite` 中实现 `needsClarification` 字段。此 Task 强化其触发条件和前端交互。

- [ ] **Step 1: 在 CLASSIFY_AND_REWRITE_PROMPT 中增加歧义触发条件**

```
## Clarification Triggers
Set needsClarification=true when:
- Query mentions a term that maps to multiple things in a knowledge base (e.g., "配置" without specifying what)
- Query uses only 1-2 vague words (e.g., "怎么用", "设置")
- Query references "那个功能" without clear antecedent in history
Do NOT set needsClarification for:
- Queries that are clear but might not have results
- Short but unambiguous queries (e.g., "SSH端口")
```

- [ ] **Step 2: 前端渲染追问为普通助手消息**

追问消息已在 Task 3 的 Route 中以 `yield JSON.stringify({ content })` 形式发送，前端自然渲染为助手消息。用户回答后作为新一轮对话自然流转。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/services/query-understanding.service.ts
git commit -m "feat(ai): enhance ambiguity detection triggers for clarification"
```

---

### Task 14: 深度研究模式（可选）

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`
- Modify: `wiki/docs/.vitepress/theme/types/index.ts`

- [ ] **Step 1: 在 AnswerWithContextInput 中添加 deepResearch 布尔参数**

```typescript
export interface AnswerWithContextInput {
  query: string;
  workspaceId: string;
  pageSlugId?: string;
  images?: AiImagePayload[];
  history?: AiChatMessage[];
  scope?: RetrievalScope;
  deepResearch?: boolean; // 新增
}
```

- [ ] **Step 2: 当 deepResearch=true 时，强制 complexity=3 + 扩大检索范围**

在 `answerWithContext` 的路由决策中：

```typescript
    if (input.deepResearch) {
      understanding.complexity = 3;
    }
```

并在 agenticSearch 中将 top-K 从 7 提升到 10，contextParts 的 slice 从 2500 提升到 5000。

- [ ] **Step 3: 前端添加"深度研究"切换按钮**

在 AIChat.vue 的输入栏旁添加一个切换按钮，控制 `deepResearch` 参数。

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/types/index.ts wiki/docs/.vitepress/theme/services/docmost.ts
git commit -m "feat(wiki): add deep research mode with expanded retrieval

- Deep Research toggle button in chat input bar
- Forces complexity=3 and agentic search
- Expanded context limits: top-10 results, 5000 chars per source"
```

---

## Reviewer Fixes Applied

### 写计划时预置的修订

| # | 修订 | 位置 |
|---|------|------|
| R-1 | classifyAndRewrite 失败时回退到默认值（不阻塞） | Task 3 Step 3 |
| R-2 | 推荐问题生成失败时静默跳过（不阻塞主回答） | Task 3 Step 3 |
| R-3 | Groundedness 验证非阻塞（只发 warning 不拒绝回答） | Task 10 Step 3 |
| R-4 | agenticSearch 设置检索预算上限（max 2 rounds） | Task 8 Step 2 |
| R-5 | 服务端会话设置硬性大小上限（50KB）和 TTL（24h） | Task 12 Step 1 |
| R-6 | 前端 SSE 类型向后兼容（新字段全部 optional） | Task 4 Step 1 |
| R-7 | LLM JSON 解析总是 try-catch + 回退默认值 | Task 1 Step 1, Task 8 Step 1 |

### 审查后修复的关键问题

| # | 问题 | 修复 | 位置 |
|---|------|------|------|
| C-1 | `generateText` 使用顶层 import，不匹配代码库 `require()` 惯例 | 所有 `generateText` 改为方法内 `const { generateText } = require('ai');` | Task 1, 3, 8, 10 |
| C-2 | `TokenService` 在构造函数中从 optional 改为 required，破坏注入 | 保持 `tokenService?: TokenService`，新增注入也用 optional | Task 3 Step 1 |
| C-3 | Redis 注入用 `@InjectRedis` + `@nestjs-modules/ioredis`，不匹配代码库 `RedisService` + `@nestjs-labs/nestjs-ioredis` | 改用 `RedisService` + `.getOrThrow()` 模式 | Task 12 Step 1 |
| I-1 | 推荐问题声称"+0 延迟(异步)"但实际是 await 阻塞 | 文档已澄清：延迟在回答文本之后，不影响用户体验，但 [DONE] 延迟 1-2s | Task 3 |
| I-9 | agenticSearch 按 pageId 合并丢失同页多 chunk 证据 | 改为按 `pageId:chunkIndex` 合并 | Task 8 Step 2 |
| I-10 | AnswerVerifierService 注入未在构造函数中声明 | 已在 C-2 修复中一并添加到构造函数 | Task 10 |

### 审查建议（已确认但留给实施时处理）

| # | 建议 | 说明 |
|---|------|------|
| S-1 | classifyAndRewrite 添加超时 AbortSignal | 实施时在 generateText 中添加 2s 超时 |
| S-4 | Task 9 内容轻量，可合并到 Task 1 | 保留独立 Task 便于追踪，实施时可跳过直接在 Task 1 中完成 |
| S-5 | Session ID 用 UUID 而非 IP 哈希 | 实施时使用 crypto.randomUUID() |
| S-7 | 缺少显式测试步骤 | 5 个关键路径需手动验证（SSE 事件顺序、短路返回、JSON 解析失败、Route C 重试、并发限流） |
| I-3 | intent/complexity SSE 事件无前端消费者 | 保留用于调试和未来 UI 扩展，暂不添加前端处理 |
| I-7 | AIChatWelcome 已有 pageTitle prop | 实施时只需改 suggestions 为 computed，不需重新声明 props |
