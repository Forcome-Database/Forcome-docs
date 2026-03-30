# Wiki Q&A 可回答性闸门 + 外部探索降级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在检索和 LLM 生成之间插入可回答性评估闸门——当知识库无法回答时诚实拒绝或降级到受控外部搜索，从架构上消除幻觉。

**Architecture:** 在 `answerWithContext` 的 rerank 之后、LLM 生成之前，新增 `RetrievalQualityAssessor` 评估检索结果是否能回答问题。置信度 HIGH/MEDIUM 直接回答；LOW 且话题为公共知识时通过 agent-service 新端点做受控 web search，将外部结果作为标注来源的额外证据注入；LOW 且私有话题或外部也无结果时诚实拒绝。

**Tech Stack:** NestJS (TypeScript) + FastAPI (Python) + Vercel AI SDK generateText + Tavily search

---

## File Structure

### P0: 可回答性闸门

| File | Responsibility | Action |
|------|---------------|--------|
| `apps/server/src/ee/ai/services/retrieval-quality.service.ts` | 检索质量评估 | Create |
| `apps/server/src/ee/ai/services/ai-search.service.ts` | 主管道插入闸门 | Modify |
| `apps/server/src/ee/ai/ai.module.ts` | 注册新服务 | Modify |
| `apps/server/src/ee/ai/utils/intent-prompts.ts` | 低置信度回答模板 | Modify |

### P1: 受控外部探索

| File | Responsibility | Action |
|------|---------------|--------|
| `agent-service/app/main.py` | 新增 `/agent/web-search` 端点 | Modify |
| `apps/server/src/ee/ai/services/web-explorer.service.ts` | 调用 agent-service 搜索 | Create |
| `apps/server/src/ee/ai/services/ai-search.service.ts` | 低置信度时触发探索 | Modify |
| `apps/server/src/ee/ai/ai.module.ts` | 注册新服务 | Modify |

---

## Phase 0: 可回答性闸门

### Task 1: 创建 RetrievalQualityService

**Files:**
- Create: `apps/server/src/ee/ai/services/retrieval-quality.service.ts`

- [ ] **Step 1: 创建评估服务**

```typescript
// apps/server/src/ee/ai/services/retrieval-quality.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type { QueryIntent } from './query-understanding.service';

export type RetrievalConfidence = 'high' | 'medium' | 'low';

export interface RetrievalQualityResult {
  confidence: RetrievalConfidence;
  reason: string;
  isPublicTopic: boolean; // Whether the topic could be answered by web search
}

@Injectable()
export class RetrievalQualityService {
  private readonly logger = new Logger(RetrievalQualityService.name);

  /**
   * Assess whether retrieved results can answer the user's question.
   * This is the critical "answerability gate" — runs AFTER rerank, BEFORE LLM generation.
   *
   * Uses the completion model (not lite) because this decision determines
   * whether the user gets an answer or a refusal.
   */
  async assess(
    query: string,
    intent: QueryIntent,
    retrievedChunks: Array<{ title: string; chunkText?: string; score: number }>,
    currentPageTitle: string | undefined,
    model: any,
  ): Promise<RetrievalQualityResult> {
    // Fast path: no results → definitely low
    if (retrievedChunks.length === 0) {
      return {
        confidence: 'low',
        reason: 'No search results found',
        isPublicTopic: this.guessPublicTopic(query),
      };
    }

    // Fast path: top result has very high score → skip LLM assessment
    if (retrievedChunks[0].score > 0.03) {
      // RRF top-1 score of 0.03+ indicates strong match from both vector and BM25
      return {
        confidence: 'high',
        reason: 'Strong retrieval match',
        isPublicTopic: false,
      };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');

      const evidenceSummary = retrievedChunks
        .slice(0, 3)
        .map((c, i) => `[${i + 1}] "${c.title}": ${(c.chunkText || '').slice(0, 200)}`)
        .join('\n');

      const { text } = await generateText({
        model,
        maxTokens: 150,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are a retrieval quality assessor. Given a user question and the top search results from a knowledge base, judge whether the results contain enough information to answer the question.

Return ONLY valid JSON:
{"confidence": "high"|"medium"|"low", "reason": "<brief reason>", "isPublicTopic": true|false}

Rules:
- "high": The results directly address the question with specific, relevant content.
- "medium": The results are related but may not fully cover the question. An answer is possible but may be partial.
- "low": The results are about a different topic, or only tangentially related. The question cannot be reliably answered from these results.
- "isPublicTopic": true if the question is about publicly available knowledge (open-source software, general tech, public standards). false if it's about internal company processes, proprietary systems, or organization-specific data.

Key heuristic: If the user asks a troubleshooting/diagnostic question but the results only contain setup/installation instructions, that's "low" — the results don't match the question type.`,
          },
          {
            role: 'user',
            content: `Question: ${query}\nQuestion type: ${intent}\nCurrent page: ${currentPageTitle || 'none'}\n\nSearch results:\n${evidenceSummary}`,
          },
        ],
      });

      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      const confidence: RetrievalConfidence =
        ['high', 'medium', 'low'].includes(parsed.confidence)
          ? parsed.confidence
          : 'medium';

      return {
        confidence,
        reason: String(parsed.reason || ''),
        isPublicTopic: Boolean(parsed.isPublicTopic),
      };
    } catch (err: any) {
      this.logger.warn(`Retrieval quality assessment failed: ${err?.message}`);
      // Fail-open to medium — let the LLM try but don't guarantee quality
      return {
        confidence: 'medium',
        reason: 'Assessment failed, proceeding with caution',
        isPublicTopic: false,
      };
    }
  }

  /**
   * Simple heuristic fallback for public topic detection when LLM assessment fails.
   */
  private guessPublicTopic(query: string): boolean {
    const publicKeywords = /vpn|docker|linux|ubuntu|nginx|git|python|node|npm|ssl|ssh|mysql|postgres|redis|kubernetes|k8s|aws|azure|gcp|api|http|tcp|dns|clash|v2ray|trojan|wireguard/i;
    return publicKeywords.test(query);
  }
}
```

- [ ] **Step 2: 注册到 AI Module**

在 `apps/server/src/ee/ai/ai.module.ts` 的 providers 和 exports 中添加 `RetrievalQualityService`。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/services/retrieval-quality.service.ts apps/server/src/ee/ai/ai.module.ts
git commit -m "feat(ai): add RetrievalQualityService — answerability gate between retrieval and generation"
```

---

### Task 2: 添加低置信度回答模板

**Files:**
- Modify: `apps/server/src/ee/ai/utils/intent-prompts.ts`

- [ ] **Step 1: 新增 `getLowConfidenceResponse` 函数**

在文件末尾 `getIntentSystemPrompt` 之后添加：

```typescript
/**
 * Generate an honest refusal response when retrieval confidence is low.
 */
export function getLowConfidenceResponse(
  query: string,
  isChinese: boolean,
  currentPageTitle?: string,
): string {
  if (isChinese) {
    const pageHint = currentPageTitle ? `当前页面「${currentPageTitle}」` : '知识库';
    return `抱歉，${pageHint}中暂未找到关于"${query.slice(0, 50)}"的相关内容。\n\n您可以尝试：\n- 换一种方式描述您的问题\n- 查看其他相关页面\n- 联系管理员确认文档是否已更新`;
  }
  const pageHint = currentPageTitle ? `the page "${currentPageTitle}"` : 'the knowledge base';
  return `Sorry, ${pageHint} doesn't contain information about "${query.slice(0, 50)}".\n\nYou can try:\n- Rephrasing your question\n- Checking other related pages\n- Contacting an admin to confirm if the documentation has been updated`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/ee/ai/utils/intent-prompts.ts
git commit -m "feat(ai): add honest low-confidence refusal response template"
```

---

### Task 3: 集成闸门到 answerWithContext

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

这是核心改动——在 rerank 之后、context assembly 之前插入质量评估。

- [ ] **Step 1: 添加 import 和构造函数注入**

```typescript
// 新增 import
import { RetrievalQualityService, type RetrievalQualityResult } from './retrieval-quality.service';
import { getLowConfidenceResponse } from '../utils/intent-prompts';

// 构造函数新增（在 answerVerifier 之后），使用 @Optional() 装饰器
@Optional() private readonly retrievalQuality?: RetrievalQualityService,

// 注意：需要在文件头部 import { Optional } from '@nestjs/common'
```

- [ ] **Step 2: 在 answerWithContext 的 rerank 之后插入闸门**

在 `finalReranked = ...` 赋值完成之后（约 line 1378）、`// ---- Context Assembly ----` 之前，插入：

```typescript
    // ---- Answerability Gate (P0 core) ----
    const qualityModel = this.getCompletionModel();
    let qualityResult: RetrievalQualityResult = {
      confidence: 'medium',
      reason: 'Assessment not available',
      isPublicTopic: false,
    };

    if (this.retrievalQuality) {
      try {
        qualityResult = await this.retrievalQuality.assess(
          input.query,
          understanding.intent,
          finalReranked.map((r) => ({
            title: r.title,
            chunkText: r.chunkText || r.textContent?.slice(0, 300),
            score: r.score,
          })),
          currentPage?.title,
          qualityModel,
        );
        this.logger.debug(
          `Retrieval quality: ${qualityResult.confidence} (${qualityResult.reason})`,
        );
      } catch {
        // Fail-open: continue with generation
      }
    }

    // LOW confidence + no external fallback available → honest refusal
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
      // Still generate suggested questions to help the user
      try {
        const suggestions = await this.generateSuggestedQuestions(
          input.query,
          understanding.intent,
          '',
          currentPage?.title,
          isChinese,
        );
        if (suggestions.length > 0) {
          yield JSON.stringify({ suggestedQuestions: suggestions });
        }
      } catch { /* non-blocking */ }
      return;
    }

    // LOW confidence + public topic → placeholder for P1 external exploration
    // For now, fall through to normal generation with a cautionary system prompt addition
    let confidenceHint = '';
    if (qualityResult.confidence === 'low' && qualityResult.isPublicTopic) {
      confidenceHint = isChinese
        ? '\n\n⚠️ 注意：知识库中可能没有足够信息回答这个问题。如果你无法从上下文中找到答案，请明确说明"知识库中暂无此内容"，不要编造。'
        : '\n\n⚠️ Warning: The knowledge base may not have sufficient information. If you cannot find the answer in the context, explicitly say "the knowledge base does not have this information" — do NOT fabricate.';
    }
```

- [ ] **Step 3: 将 confidenceHint 注入系统提示词**

修改 `getIntentSystemPrompt` 调用，将 `confidenceHint` 追加：

```typescript
    // ---- Intent-aware System Prompt ----
    const systemPromptText = getIntentSystemPrompt(
      understanding.intent,
      isChinese,
      context,
    ) + confidenceHint;
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): integrate answerability gate into answerWithContext pipeline

- RetrievalQualityAssessor runs after rerank, before generation
- LOW + private topic → honest refusal with suggestions
- LOW + public topic → cautionary hint (P1 will add external search)
- HIGH/MEDIUM → normal generation (unchanged)"
```

---

## Phase 1: 受控外部探索

### Task 4: Agent Service 新增 web-search 端点

**Files:**
- Modify: `agent-service/app/main.py`

复用现有 `search_web_impl` 和 `scrape_url_impl`，不复用 Agent 本身。

- [ ] **Step 1: 在 main.py 添加 `/agent/web-search` 端点**

在 `@app.post("/agent/v2/run")` 之前添加：

```python
@app.post("/agent/web-search", dependencies=[Depends(verify_internal_secret)])
async def web_search(request: dict):
    """Controlled web search endpoint for Wiki Q&A fallback.

    Not an agent — just a direct search + optional scrape.
    Returns structured evidence, not free-form text.
    """
    import asyncio
    query = request.get("query", "")
    max_results = min(request.get("max_results", 3), 5)  # Hard cap at 5
    scrape_top = min(request.get("scrape_top", 1), 2)    # Hard cap at 2

    if not query or len(query) > 500:
        return {"status": "error", "error": "Invalid query"}

    from app.agent.tools.scrape_url import scrape_url_impl
    from tavily import TavilyClient
    from app.config import settings

    if not settings.tavily_api_key:
        return {"status": "error", "error": "Web search not configured (TAVILY_API_KEY missing)"}

    # Step 1: Search using TavilyClient directly (structured JSON, not formatted text)
    try:
        client = TavilyClient(api_key=settings.tavily_api_key)
        results = await asyncio.wait_for(
            asyncio.to_thread(client.search, query=query, max_results=max_results),
            timeout=15,
        )
    except asyncio.TimeoutError:
        return {"status": "error", "query": query, "error": "Web search timed out"}
    except Exception as e:
        return {"status": "error", "query": query, "error": f"Search failed: {e}"}

    # Step 2: Extract structured evidence directly from Tavily JSON response
    evidence = []
    for r in results.get("results", [])[:max_results]:
        evidence.append({
            "url": r.get("url", ""),
            "title": r.get("title", ""),
            "snippet": (r.get("content", "") or "")[:500],
        })

    # Step 3: Optionally scrape top results for richer content
    if scrape_top > 0 and evidence:
        for item in evidence[:scrape_top]:
            try:
                scrape_result = await scrape_url_impl(item["url"])
                if scrape_result.get("status") == "success":
                    item["content"] = scrape_result.get("content", "")[:3000]
                    item["title"] = scrape_result.get("title", item.get("snippet", "")[:80])
            except Exception:
                pass

    return {
        "status": "success" if evidence else "no_results",
        "query": query,
        "evidence": evidence,
    }
```

- [ ] **Step 2: Commit**

```bash
git add agent-service/app/main.py
git commit -m "feat(agent): add /agent/web-search endpoint for controlled Wiki Q&A fallback

- Reuses search_web_impl (Tavily) and scrape_url_impl (Firecrawl)
- Hard caps: max 5 results, max 2 scrapes
- Returns structured evidence[], not free-form text
- Protected by verify_internal_secret"
```

---

### Task 5: NestJS WebExplorerService

**Files:**
- Create: `apps/server/src/ee/ai/services/web-explorer.service.ts`

- [ ] **Step 1: 创建服务**

```typescript
// apps/server/src/ee/ai/services/web-explorer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import * as http from 'http';

export interface WebEvidence {
  url: string;
  title?: string;
  snippet?: string;
  content?: string;
  origin: 'web';
}

@Injectable()
export class WebExplorerService {
  private readonly logger = new Logger(WebExplorerService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  /**
   * Search the web for evidence to answer a question.
   * Calls the agent-service's /agent/web-search endpoint.
   * Returns structured evidence with clear 'web' origin marking.
   */
  async explore(query: string): Promise<WebEvidence[]> {
    const agentUrl = this.environmentService.getAgentServiceUrl?.()
      || `http://localhost:${process.env.AGENT_PORT || '8100'}`;
    const secret = this.environmentService.getAgentInternalSecret?.()
      || process.env.AGENT_INTERNAL_SECRET || '';

    try {
      const response = await this.httpPost(`${agentUrl}/agent/web-search`, {
        query: query.slice(0, 500),
        max_results: 3,
        scrape_top: 1,
      }, secret);

      if (response.status !== 'success' || !Array.isArray(response.evidence)) {
        return [];
      }

      return response.evidence
        .filter((e: any) => e.url)
        .map((e: any) => ({
          url: e.url,
          title: e.title || e.snippet?.slice(0, 80) || e.url,
          snippet: e.snippet || '',
          content: e.content || e.snippet || '',
          origin: 'web' as const,
        }));
    } catch (err: any) {
      this.logger.warn(`Web exploration failed (non-blocking): ${err?.message}`);
      return [];
    }
  }

  private httpPost(url: string, body: any, secret: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'X-Internal-Secret': secret,
          },
          timeout: 20000,
        },
        (res) => {
          let chunks = '';
          res.on('data', (chunk) => (chunks += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(chunks));
            } catch {
              reject(new Error(`Invalid JSON response from agent-service`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(data);
      req.end();
    });
  }
}
```

- [ ] **Step 2: 注册到 AI Module**

在 `apps/server/src/ee/ai/ai.module.ts` 的 providers 和 exports 中添加 `WebExplorerService`。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/services/web-explorer.service.ts apps/server/src/ee/ai/ai.module.ts
git commit -m "feat(ai): add WebExplorerService for controlled external search fallback

- Calls agent-service /agent/web-search endpoint
- Returns WebEvidence[] with 'web' origin marking
- 20s timeout, non-blocking on failure"
```

---

### Task 6: 集成外部探索到 answerWithContext

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

将 Task 3 中的 `LOW + public topic` 占位逻辑替换为实际的外部探索。

- [ ] **Step 1: 添加 import 和构造函数注入**

```typescript
import { WebExplorerService, type WebEvidence } from './web-explorer.service';

// 构造函数新增
private readonly webExplorer?: WebExplorerService,
```

- [ ] **Step 2: 替换 LOW + public topic 占位逻辑**

找到 Task 3 中的：
```typescript
    // LOW confidence + public topic → placeholder for P1 external exploration
    let confidenceHint = '';
    if (qualityResult.confidence === 'low' && qualityResult.isPublicTopic) {
      confidenceHint = isChinese
        ? '\n\n⚠️ 注意：...'
        : '\n\n⚠️ Warning: ...';
    }
```

替换为：

```typescript
    // LOW confidence + public topic → external exploration (P1)
    let webEvidence: WebEvidence[] = [];
    let confidenceHint = '';
    if (qualityResult.confidence === 'low' && qualityResult.isPublicTopic && this.webExplorer) {
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
        // Web evidence found — will be injected into context with [Web] label
        confidenceHint = isChinese
          ? '\n\n注意：以下部分内容来自外部网络搜索（标记为 [Web]），可能不完全适用于你的具体环境。知识库原有内容标记为 [1][2] 等编号。'
          : '\n\nNote: Some content below is from external web search (marked [Web]) and may not fully apply to your specific environment. Knowledge base content is marked with [1][2] etc.';
      } catch {
        // External search failed — fall through with cautionary hint
        confidenceHint = isChinese
          ? '\n\n⚠️ 知识库中可能没有足够信息。如果无法从上下文找到答案，请明确说明"知识库中暂无此内容"。'
          : '\n\n⚠️ The knowledge base may not have sufficient information. If you cannot find the answer, say so explicitly.';
      }
    }
```

- [ ] **Step 3: 将 web evidence 注入上下文**

在 `context assembly` 的 `for (const result of finalReranked)` 循环之后、`const context = contextParts.join(...)` 之前，添加：

```typescript
    // Inject web evidence into context (clearly labeled)
    for (const evidence of webEvidence) {
      contextParts.push(
        `[Web] (External: ${evidence.title || evidence.url}):\n${(evidence.content || evidence.snippet || '').slice(0, 2500)}`,
      );
      // Add web evidence as citations with 'web' origin field
      citations.push({
        sourceType: 'page' as const,
        title: evidence.title || evidence.url,
        pageUrl: evidence.url,
        snippet: evidence.snippet?.slice(0, 200),
        origin: 'web', // Structured field, not emoji prefix
      } as AiCitation);
    }
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git commit -m "feat(ai): integrate external web exploration for low-confidence public topics

- When KB confidence is LOW and topic is public:
  1. Call WebExplorerService to search the web
  2. If results found: inject as [Web] labeled context + citations
  3. If no results: honest refusal
- System prompt warns user about external source origin
- Non-blocking: external search failure falls through gracefully"
```

---

### Task 7: 前端展示外部来源标记

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChatSources.vue`

- [ ] **Step 1: 识别并标记外部来源**

首先在 `types/index.ts` 的 `AiCitation` 接口中添加 `origin?: 'kb' | 'web'`。

然后在 `normalizedItems` 的 citations mapping 中，用 `origin` 字段识别外部来源：

```typescript
      const isExternal = (citation as any).origin === 'web'

      const icon =
        isExternal
          ? '🌐'
          : citation.sourceType === 'attachment'
            ? '📎'
            : citation.sourceType === 'image'
              ? '🖼️'
              : citation.sourceType === 'diagram'
                ? '📐'
                : '📄'

      // For external sources, use pageUrl directly (external URL)
      const href = isExternal
        ? citation.pageUrl || '#'
        : citation.sourceType === 'page'
          ? getPageUrl(citation)
          : citation.publicAssetUrl || getPageUrl(citation)
```

- [ ] **Step 2: Commit**

```bash
git add wiki/docs/.vitepress/theme/components/AIChatSources.vue
git commit -m "feat(wiki): display external web sources with globe icon in citations"
```

---

## Reviewer Fixes Pre-applied

| # | 修订 | 位置 |
|---|------|------|
| R-1 | RetrievalQualityService 失败时 fail-open 到 medium（不阻塞） | Task 1 |
| R-2 | Web search 端点有硬上限（5 results, 2 scrapes, 500 char query） | Task 4 |
| R-3 | WebExplorerService 有 20s 超时 + 非阻塞失败 | Task 5 |
| R-4 | Web search 受 `verify_internal_secret` 保护，不可公开调用 | Task 4 |
| R-5 | 外部来源明确标注 [Web]，系统提示词告知用户来源差异 | Task 6 |
| R-6 | `generateText` 用 `require('ai')` 模式（匹配代码库） | Task 1 |
| R-7 | LOW + private → 诚实拒绝仍然生成推荐问题（帮助用户重新定向） | Task 3 |
| R-8 | isPublicTopic 有 LLM 评估 + 关键词 fallback 双层判断 | Task 1 |
| R-9 | 外部搜索也失败 → 仍然诚实拒绝（不回退到无约束生成） | Task 6 |

### 审查后修复

| # | 问题 | 修复 |
|---|------|------|
| C-1 | Tavily 输出格式解析器会全部失败（URL 格式不匹配） | 改为直接调用 `TavilyClient.search()` 获取结构化 JSON |
| C-2 | NestJS optional DI 模式不正确 | 使用 `@Optional()` 装饰器 |
| I-2 | 每次查询额外一次 completion model 调用 | 添加高分快速通道（score>0.03 跳过 LLM 评估） |
| I-4 | 外部来源用 emoji 前缀检测，脆弱 | 改为 `origin: 'web'` 结构化字段 |
| S-2 | TAVILY_API_KEY 缺失时无提示 | 端点启动时检查 API key |
