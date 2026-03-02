# Wiki AI 知识问答板块渐进式重构 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 渐进式重构 wiki AI 问答板块 — 清理死代码、拆分巨石组件、实现多轮对话、来源卡片化、推荐问题、RAG 阈值和 Prompt 语言跟随。

**Architecture:** 前端 VitePress + Vue 3 SFC → 拆分 composable + 子组件 + 独立样式。后端 NestJS → DTO/Service/AI-Search 三层扩展 history 参数，改 `streamText({ prompt })` 为 `streamText({ messages })`。

**Tech Stack:** Vue 3 (Composition API), VitePress, ant-design-x-vue, markdown-it, NestJS 11, Fastify, Kysely, Vercel AI SDK v6, pgvector

**注意:** 本项目 wiki 前端和 public-wiki 后端均无测试基础设施（无 test 文件），本计划以手动验证为主，每步通过编译检查 + 浏览器验证。

---

## Task 1: 清理死代码

**目标:** 删除 ~700 行未使用代码，减少维护负担

**Files:**
- Delete: `wiki/docs/.vitepress/theme/components/AIChatMessage.vue`
- Modify: `wiki/docs/.vitepress/theme/composables/useAIChat.ts`
- Modify: `wiki/docs/.vitepress/theme/types/index.ts` (删除 `AIChatMessageProps`)

**Step 1: 确认 AIChatMessage.vue 未被引用**

```bash
cd wiki && grep -r "AIChatMessage" docs/.vitepress/ --include="*.vue" --include="*.ts"
```

Expected: 只在 `AIChatMessage.vue` 自身和 `types/index.ts` 中出现

**Step 2: 删除 AIChatMessage.vue**

删除文件 `wiki/docs/.vitepress/theme/components/AIChatMessage.vue`（257 行）

**Step 3: 确认 useAIChat() 函数体未被调用**

```bash
cd wiki && grep -r "useAIChat()" docs/.vitepress/ --include="*.vue" --include="*.ts"
```

Expected: 只在 `useAIChat.ts` 自身定义处出现

**Step 4: 精简 useAIChat.ts — 只保留工具函数**

将 `wiki/docs/.vitepress/theme/composables/useAIChat.ts` 从 452 行精简为仅保留被 AIChat.vue import 的 4 个工具函数：

```typescript
/**
 * AI 问答工具函数
 * 提供 Dify 模式配置和快捷键修饰符获取
 */

import type { DifyMode } from '../types'

/**
 * 获取 Dify 模式配置
 */
export function getDifyMode(): DifyMode {
  const mode = import.meta.env.VITE_DIFY_MODE as string
  return mode === 'embed' ? 'embed' : 'api'
}

/**
 * 获取 Dify 嵌入链接 URL
 */
export function getDifyEmbedUrl(): string {
  return import.meta.env.VITE_DIFY_EMBED_URL as string || ''
}

/**
 * 检查嵌入模式是否已配置
 */
export function isEmbedConfigured(): boolean {
  return getDifyMode() === 'embed' && !!getDifyEmbedUrl()
}

/**
 * 获取操作系统对应的快捷键修饰符
 */
export function getAIChatModifierKey(): string {
  if (typeof navigator === 'undefined') return '⌘'
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  return isMac ? '⌘' : 'Ctrl'
}
```

**Step 5: 删除 types/index.ts 中的 AIChatMessageProps**

删除 `wiki/docs/.vitepress/theme/types/index.ts` 第 368-372 行：

```typescript
// 删除以下内容
/** AIChatMessage 组件 Props */
export interface AIChatMessageProps {
  /** 消息对象 */
  message: ChatMessage
}
```

**Step 6: 验证编译**

```bash
cd wiki && npx vitepress build docs 2>&1 | head -20
```

Expected: 无编译错误

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: remove dead code — AIChatMessage.vue + useAIChat() body (~700 lines)"
```

---

## Task 2: 扩展类型定义

**目标:** 为 ChatMessage 添加 sources 字段，新增 AiHistoryMessage 类型

**Files:**
- Modify: `wiki/docs/.vitepress/theme/types/index.ts`

**Step 1: 为 ChatMessage 添加 sources 字段**

在 `types/index.ts` 第 108-119 行的 `ChatMessage` 接口中添加 `sources` 字段：

```typescript
/** 聊天消息 */
export interface ChatMessage {
  /** 消息 ID */
  id: string
  /** 角色 */
  role: MessageRole
  /** 消息内容 */
  content: string
  /** 时间戳 */
  timestamp: number
  /** 是否正在流式输出 */
  isStreaming?: boolean
  /** AI 来源引用（仅 assistant 消息） */
  sources?: AiSource[]
}

/** AI 来源引用 */
export interface AiSource {
  title: string
  slugId: string
  spaceSlug: string
}

/** 发送给后端的历史消息 */
export interface AiHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}
```

**Step 2: 验证编译**

```bash
cd wiki && npx vitepress build docs 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(types): add sources field to ChatMessage, add AiSource and AiHistoryMessage types"
```

---

## Task 3: 后端 — DTO + 多轮对话管道

**目标:** DTO 增加 history 字段，透传到 ai-search.service

**Files:**
- Modify: `apps/server/src/core/public-wiki/dto/public-wiki.dto.ts`
- Modify: `apps/server/src/core/public-wiki/public-wiki.controller.ts`
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`

**Step 1: DTO 增加 history 字段**

在 `public-wiki.dto.ts` 的 `PublicAiAnswerDto` 类（第 37-45 行）增加：

```typescript
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// 在文件末尾 PublicAiAnswerDto 之前添加
export class AiHistoryMessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class PublicAiAnswerDto {
  @IsNotEmpty()
  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  pageSlugId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiHistoryMessageDto)
  history?: AiHistoryMessageDto[];
}
```

**Step 2: Controller 透传 history**

修改 `public-wiki.controller.ts` 第 92-97 行，`aiAnswers` 方法中传递 `dto.history`：

```typescript
    try {
      for await (const chunk of this.publicWikiService.aiAnswers(
        dto.query,
        workspace.id,
        dto.pageSlugId,
        dto.history,  // 新增
      )) {
        res.raw.write(`data: ${chunk}\n\n`);
      }
```

**Step 3: Service 透传 history**

修改 `public-wiki.service.ts` 第 279-303 行的 `aiAnswers` 方法签名和调用：

```typescript
  async *aiAnswers(
    query: string,
    workspaceId: string,
    pageSlugId?: string,
    history?: { role: string; content: string }[],  // 新增
  ): AsyncGenerator<string> {
    let AiSearchService: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const aiModule = require('../../ee/ai/services/ai-search.service');
      AiSearchService = this.moduleRef.get(aiModule.AiSearchService, {
        strict: false,
      });
    } catch (err) {
      this.logger.debug('AI search module not available');
      yield JSON.stringify({ error: 'AI search is not available' });
      return;
    }

    for await (const chunk of AiSearchService.answerWithContext(
      query,
      workspaceId,
      pageSlugId,
      history,  // 新增
    )) {
      yield chunk;
    }
  }
```

**Step 4: 验证后端编译**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | head -30
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(backend): add history param to AI answer pipeline (DTO → Controller → Service)"
```

---

## Task 4: 后端 — RAG 质量优化

**目标:** 向量搜索阈值 + Prompt 语言跟随 + `streamText({ messages })` 多轮对话

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

**Step 1: 向量搜索添加距离阈值**

修改 `ai-search.service.ts` 第 103-132 行的 `searchSimilarPages` 方法，在 SQL WHERE 中加阈值：

```typescript
  async searchSimilarPages(
    query: string,
    workspaceId: string,
    limit = 5,
    distanceThreshold = 0.8,  // 新增参数
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
```

**Step 2: 改写 answerWithContext — Prompt 语言跟随 + messages 模式 + history 支持**

完整替换 `ai-search.service.ts` 第 134-207 行的 `answerWithContext` 方法：

```typescript
  async *answerWithContext(
    query: string,
    workspaceId: string,
    pageSlugId?: string,
    history?: { role: string; content: string }[],  // 新增
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

    // 2. 向量搜索补充上下文（带距离阈值）
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

    // 注入历史消息（如有）
    if (history && history.length > 0) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    // 当前问题
    messages.push({ role: 'user', content: query });

    const model = this.getCompletionModel();
    const result = streamText({ model, messages });

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

    for await (const chunk of result.textStream) {
      yield JSON.stringify({ content: chunk });
    }
  }
```

**Step 3: 验证后端编译**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | head -30
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(ai-search): add distance threshold, language-aware prompt, multi-turn messages support"
```

---

## Task 5: 前端 — 抽离样式到独立文件

**目标:** 将 AIChat.vue 中 612 行 `<style scoped>` 抽到独立 CSS 文件，保持行为不变

**Files:**
- Create: `wiki/docs/.vitepress/theme/styles/ai-chat.css`
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue` (删除 `<style>` 块，改为 import)

**Step 1: 创建 styles/ai-chat.css**

从 AIChat.vue 第 456-1068 行的 `<style scoped>` 内容（去掉 `<style scoped>` 和 `</style>` 标签）复制到新文件 `wiki/docs/.vitepress/theme/styles/ai-chat.css`。

注意：由于不再是 scoped，所有 `:deep()` 伪选择器需要去掉。同时为所有规则添加 `.ai-chat-root` 前缀作为作用域，防止样式泄漏。

转换规则：
- `:deep(.ai-chat-markdown ...)` → `.ai-chat-root .ai-chat-markdown ...`
- `:deep(.ant-bubble-content)` → `.ai-chat-root .ant-bubble-content`
- `:deep(.ant-sender)` → `.ai-chat-root .ant-sender`
- `.dark :deep(...)` → `.dark .ai-chat-root ...`
- 其他非 `:deep()` 的选择器保持不变（已经有 `.ai-chat-*` 前缀）

**Step 2: AIChat.vue 中移除 `<style>` 块，改为 import**

在 `<script setup>` 开头添加：

```typescript
import '../styles/ai-chat.css'
```

删除整个 `<style scoped>...</style>` 块（第 456-1068 行）。

**Step 3: 验证样式不回退**

```bash
cd wiki && npx vitepress dev docs --host
```

浏览器手动验证：打开 AI 面板 → 发送消息 → 检查样式一致

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: extract AIChat styles to standalone ai-chat.css (612 lines)"
```

---

## Task 6: 前端 — 来源引用卡片组件

**目标:** 创建 AIChatSources.vue，以可折叠卡片展示 AI 来源引用

**Files:**
- Create: `wiki/docs/.vitepress/theme/components/AIChatSources.vue`
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css` (添加来源卡片样式)

**Step 1: 创建 AIChatSources.vue**

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vitepress'
import type { AiSource } from '../types'

const props = defineProps<{
  sources: AiSource[]
}>()

const isExpanded = ref(false)
const route = useRoute()

const getCurrentLang = (): string => {
  const match = route.path.match(/^\/(zh|en|vi)\//)
  return match ? match[1] : 'zh'
}

const sourceLinks = computed(() =>
  props.sources.map(s => ({
    title: s.title || 'Untitled',
    url: `/${getCurrentLang()}/docs/${s.spaceSlug}/${s.slugId}`,
  }))
)
</script>

<template>
  <div v-if="sources.length > 0" class="ai-sources">
    <button class="ai-sources-toggle" @click="isExpanded = !isExpanded">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <span>{{ sources.length }} 个相关文档</span>
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        :class="{ 'ai-sources-chevron-open': isExpanded }"
        class="ai-sources-chevron"
      >
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <ul v-if="isExpanded" class="ai-sources-list">
      <li v-for="(link, i) in sourceLinks" :key="i">
        <a :href="link.url" target="_blank" rel="noopener noreferrer" class="ai-sources-link">
          {{ link.title }}
        </a>
      </li>
    </ul>
  </div>
</template>
```

**Step 2: 在 ai-chat.css 中添加来源卡片样式**

```css
/* ===== 来源引用卡片 ===== */
.ai-sources {
  margin-top: 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--c-border);
  overflow: hidden;
}

.ai-sources-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background-color: var(--c-bg-soft);
  color: var(--c-text-3);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.ai-sources-toggle:hover {
  background-color: var(--c-hover);
  color: var(--c-text-2);
}

.ai-sources-chevron {
  margin-left: auto;
  transition: transform var(--transition-fast);
}

.ai-sources-chevron-open {
  transform: rotate(180deg);
}

.ai-sources-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--c-border);
}

.ai-sources-list li {
  border-bottom: 1px solid var(--c-border);
}

.ai-sources-list li:last-child {
  border-bottom: none;
}

.ai-sources-link {
  display: block;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  color: var(--c-accent);
  text-decoration: none;
  transition: background-color var(--transition-fast);
}

.ai-sources-link:hover {
  background-color: var(--c-bg-soft);
  text-decoration: underline;
}
```

**Step 3: 验证编译**

```bash
cd wiki && npx vitepress build docs 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add AIChatSources.vue — collapsible source reference cards"
```

---

## Task 7: 前端 — 欢迎页 + 推荐问题组件

**目标:** 创建 AIChatWelcome.vue，包含智能推荐问题

**Files:**
- Create: `wiki/docs/.vitepress/theme/components/AIChatWelcome.vue`
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css` (添加推荐问题样式)

**Step 1: 创建 AIChatWelcome.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vitepress'
import { getAIChatModifierKey } from '../composables/useAIChat'

const props = defineProps<{
  isConfigured: boolean
  pageTitle?: string
}>()

const emit = defineEmits<{
  (e: 'send', question: string): void
}>()

const modifierKey = getAIChatModifierKey()
const route = useRoute()

const suggestedQuestions = computed(() => {
  const title = props.pageTitle
  if (!title) {
    return [
      '这个知识库有哪些内容？',
      '帮我找一些入门文档',
      '有什么常见问题？',
    ]
  }
  return [
    `这个页面讲了什么？`,
    `帮我总结「${title}」的要点`,
    `有什么和「${title}」相关的文档？`,
  ]
})
</script>

<template>
  <div class="ai-chat-welcome">
    <img src="/images/logo/logo.png" alt="Logo" class="welcome-logo" />
    <h3 class="welcome-title">你好！我是 IT智能助手</h3>
    <p class="welcome-text">我可以回答关于文档的问题，帮助你快速找到所需信息。</p>
    <p v-if="!isConfigured" class="welcome-hint">⚠️ AI 服务未配置，请检查环境变量</p>

    <!-- 推荐问题 -->
    <div v-if="isConfigured" class="welcome-suggestions">
      <button
        v-for="(q, i) in suggestedQuestions"
        :key="i"
        class="welcome-suggestion-btn"
        @click="emit('send', q)"
      >
        {{ q }}
      </button>
    </div>

    <div class="welcome-shortcuts">
      <kbd>{{ modifierKey }}I</kbd>
      <span>打开/关闭面板</span>
    </div>
  </div>
</template>
```

**Step 2: 在 ai-chat.css 中添加推荐问题样式**

```css
/* ===== 推荐问题 ===== */
.welcome-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 300px;
  margin-bottom: var(--spacing-4);
}

.welcome-suggestion-btn {
  padding: 8px 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  background-color: var(--c-bg-soft);
  color: var(--c-text-2);
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background-color var(--transition-fast);
}

.welcome-suggestion-btn:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background-color: var(--c-bg);
}
```

**Step 3: 验证编译**

```bash
cd wiki && npx vitepress build docs 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add AIChatWelcome.vue — welcome screen with suggested questions"
```

---

## Task 8: 前端 — DocmostService 增加 history 参数

**目标:** `docmost.ts` 的 `aiAnswers()` 方法支持传递 history

**Files:**
- Modify: `wiki/docs/.vitepress/theme/services/docmost.ts`

**Step 1: 修改 aiAnswers 方法签名**

修改 `docmost.ts` 第 91 行的 `aiAnswers` 方法，增加 `history` 参数：

```typescript
  /**
   * AI 问答（SSE 流式响应）
   * @param query 用户问题
   * @param pageSlugId 当前页面 slugId（可选，用于上下文定位）
   * @param history 对话历史（可选，用于多轮对话）
   */
  async *aiAnswers(
    query: string,
    pageSlugId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ): AsyncGenerator<DocmostAiStreamEvent> {
    this.abort()
    this.abortController = new AbortController()

    let response: Response

    try {
      const body: Record<string, any> = { query }
      if (pageSlugId) body.pageSlugId = pageSlugId
      if (history && history.length > 0) body.history = history

      response = await fetch(`${this.config.baseUrl}/ai/answers`, {
```

（后续代码不变）

**Step 2: 验证编译**

```bash
cd wiki && npx vitepress build docs 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(docmost-service): add history param to aiAnswers for multi-turn conversation"
```

---

## Task 9: 前端 — 重写 AIChat.vue（集成所有改动）

**目标:** 瘦身 AIChat.vue，集成来源卡片、推荐问题、多轮对话发送，去除来源 markdown 追加

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`

**Step 1: 重写 AIChat.vue script 部分**

核心改动点：
1. import 新组件 `AIChatSources` 和 `AIChatWelcome`
2. `sendMessage()` 中：
   - 构建 history 从 `messages.value` 最近 10 条
   - 传递 `history` 给 `docmostService.aiAnswers()`
   - **不再**将 sources 追加到 `content` 末尾，改为存入 `ChatMessage.sources`
3. `bubbleItems` 计算属性中为 assistant 消息附加 sources 渲染

关键代码修改 — `sendMessage()` 方法（替换第 166-273 行）：

```typescript
// ===== 构建对话历史（最近 10 条，用于多轮对话） =====
const buildHistory = (): { role: 'user' | 'assistant'; content: string }[] => {
  const recent = messages.value
    .filter(m => !m.isStreaming)
    .slice(-10)
  return recent.map(m => ({ role: m.role, content: m.content }))
}

// ===== 获取当前页面标题（用于推荐问题） =====
const getCurrentPageTitle = (): string | undefined => {
  if (typeof document !== 'undefined') {
    const title = document.title
    // 去掉 site suffix（e.g. "xxx | SiteName" → "xxx"）
    return title.split('|')[0]?.trim() || undefined
  }
  return undefined
}
const pageTitle = ref<string | undefined>(getCurrentPageTitle())

// 路由变化时更新 pageTitle
watch(() => route.path, () => {
  pageTitle.value = getCurrentPageTitle()
})

// ===== 发送消息 =====
const sendMessage = async (content: string) => {
  const messageContent = content.trim()
  if (!messageContent) return

  if (!docmostService && !difyService) {
    error.value = 'AI 服务未配置，请检查环境变量'
    return
  }

  inputText.value = ''
  error.value = null
  aiSources.value = []

  // 添加用户消息
  const userMessage: ChatMessage = {
    id: generateMessageId('user'),
    role: 'user',
    content: messageContent,
    timestamp: Date.now()
  }
  messages.value.push(userMessage)

  // 创建助手消息占位符
  const assistantMessage: ChatMessage = {
    id: generateMessageId('assistant'),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true
  }
  messages.value.push(assistantMessage)

  isLoading.value = true

  try {
    const assistantIndex = messages.value.length - 1

    if (docmostService) {
      // 构建历史（不含刚刚添加的占位消息）
      const history = buildHistory().slice(0, -1)

      for await (const event of docmostService.aiAnswers(
        messageContent,
        getCurrentPageSlugId(),
        history.length > 0 ? history : undefined,
      )) {
        if (event.sources) {
          aiSources.value = event.sources
        }
        if (event.content) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = {
            ...currentMsg,
            content: currentMsg.content + event.content
          }
        }
        if (event.error) {
          throw new Error(event.error)
        }
      }

      // 完成：将 sources 存入消息对象（不再追加到 content）
      const currentMsg = messages.value[assistantIndex]
      messages.value[assistantIndex] = {
        ...currentMsg,
        isStreaming: false,
        sources: aiSources.value.length > 0 ? [...aiSources.value] : undefined,
      }
    } else if (difyService) {
      // Dify 逻辑不变
      for await (const event of difyService.sendMessage(
        messageContent,
        conversationId.value || undefined
      )) {
        if ((event.event === 'message' || event.event === 'agent_message') && event.answer) {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = {
            ...currentMsg,
            content: currentMsg.content + event.answer
          }
        } else if (event.event === 'message_end') {
          const currentMsg = messages.value[assistantIndex]
          messages.value[assistantIndex] = { ...currentMsg, isStreaming: false }
          if (event.conversation_id) {
            conversationId.value = event.conversation_id
          }
        } else if (event.event === 'error') {
          throw new Error('AI 服务返回错误')
        }
      }
    }
    saveHistory()
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : '发送失败，请重试'
    error.value = errorMessage
    if (messages.value.length > 0 && messages.value[messages.value.length - 1].role === 'assistant') {
      messages.value.pop()
    }
    console.error('[AIChat] 发送消息失败:', e)
  } finally {
    isLoading.value = false
  }
}
```

**Step 2: 修改 template 部分**

替换欢迎信息区域（第 407-416 行）：

```vue
<!-- 欢迎信息 + 推荐问题 -->
<AIChatWelcome
  v-if="!hasMessages"
  :is-configured="isConfigured"
  :page-title="pageTitle"
  @send="handleSubmit"
/>
```

修改 `bubbleItems` 计算属性，为 assistant 消息的 `messageRender` 加入 sources 渲染：

```typescript
const renderMarkdown = (content: string, sources?: AiSource[]) => {
  if (!content) return h('span')
  const children = [
    h('div', {
      class: 'ai-chat-markdown',
      innerHTML: renderMarkdownToHtml(content)
    })
  ]
  if (sources && sources.length > 0) {
    children.push(h(AIChatSources, { sources }))
  }
  return h('div', null, children)
}

const bubbleItems = computed(() => {
  return messages.value.map(msg => ({
    key: msg.id,
    role: msg.role,
    content: msg.content,
    loading: msg.isStreaming && !msg.content,
    typing: msg.isStreaming ? { step: 2, interval: 50 } : undefined,
    messageRender: msg.role === 'assistant'
      ? () => renderMarkdown(msg.content, msg.sources)
      : undefined,
    classNames: msg.isStreaming && msg.role === 'assistant'
      ? { content: 'is-streaming' }
      : undefined
  }))
})
```

**Step 3: 添加 import 语句**

在 `<script setup>` 顶部添加：

```typescript
import AIChatSources from './AIChatSources.vue'
import AIChatWelcome from './AIChatWelcome.vue'
import type { AiSource } from '../types'
```

**Step 4: 验证编译**

```bash
cd wiki && npx vitepress build docs 2>&1 | head -20
```

**Step 5: 浏览器手动验证**

```bash
cd wiki && npx vitepress dev docs --host
```

验证清单：
- [ ] 打开 AI 面板，看到推荐问题按钮
- [ ] 点击推荐问题，自动发送
- [ ] AI 回答完成后，来源以可折叠卡片展示（不再追加到文本末尾）
- [ ] 点击展开/折叠来源列表
- [ ] 发送追问，AI 能理解上下文（多轮对话）
- [ ] Dify 模式不受影响
- [ ] Dark 模式样式正常

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: rebuild AIChat.vue — multi-turn conversation, source cards, suggested questions"
```

---

## Task 10: 清理和最终验证

**目标:** 确保所有改动协同工作，无回退

**Files:** 无新增修改

**Step 1: 全量编译检查**

```bash
cd wiki && npx vitepress build docs
```

```bash
cd apps/server && npx tsc --noEmit
```

**Step 2: 检查 git 状态**

```bash
git status && git log --oneline -10
```

Expected: 干净工作区，8-9 个有序 commit

**Step 3: 最终浏览器验证**

完整测试流程：
1. 启动后端 `pnpm dev`
2. 启动 wiki `cd wiki && npx vitepress dev docs --host`
3. 打开 wiki 页面 → Ctrl+I 打开 AI 面板
4. 验证推荐问题 → 点击发送
5. 验证来源卡片渲染
6. 追问验证多轮对话
7. 切换页面 → 验证会话隔离
8. Dark 模式切换
9. ESC 关闭面板

**Step 4: 确认无遗留死代码**

```bash
grep -r "AIChatMessage" wiki/docs/.vitepress/ --include="*.vue" --include="*.ts"
```

Expected: 无结果

---

## 任务依赖图

```
Task 1 (清理死代码) ──┐
Task 2 (类型扩展) ────┤
Task 3 (后端 DTO) ────┼── Task 4 (后端 RAG) ──┐
                      │                        │
Task 5 (抽离样式) ────┤                        │
Task 6 (来源卡片) ────┤                        │
Task 7 (欢迎组件) ────┤                        │
Task 8 (Service) ─────┼── Task 9 (重写 AIChat) ── Task 10 (验证)
```

Task 1-3, 5-8 可并行，Task 4 依赖 Task 3，Task 9 依赖 Task 4-8，Task 10 最后执行。
