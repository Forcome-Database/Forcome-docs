# Wiki AI Chat UX Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a frontend-first polish pass for the public wiki `AI Ask` panel that adds contextual onboarding, a clearer composer status model, a stronger source summary, a non-destructive history drawer, and clearer retry/stop recovery.

**Architecture:** Keep the current `AIChat.vue` integration and streaming contract, but move the highest-value decision logic into small pure TypeScript helpers that can be covered with `node:test` via `tsx --test`. UI composition stays in the VitePress theme layer, with one new history drawer component and focused CSS additions instead of a full panel rewrite.

**Tech Stack:** Vue 3 + VitePress theme components, TypeScript, `ant-design-x-vue`, `node:test`, `tsx --test`, `vue-tsc`, VitePress docs build.

---

## File Structure

### Tested UI view-model helpers

- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-welcome.ts`
  - Build page-aware welcome prompts and the grounding hint string.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`
  - Cover page-aware prompt generation and generic fallback behavior.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-status.ts`
  - Build the composer status row model from `pageTitle`, `isLoading`, `error`, `pendingImageCount`, and input state.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts`
  - Cover idle, image-ready, loading, and error states.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-sources.ts`
  - Normalize page citations into visible source cards and a one-line source summary for public wiki.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`
  - Cover current-page-only, current-page-plus-related-pages, related-pages-only, and asset-only citation cases.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-history.ts`
  - Normalize history entries for drawer display and mark the current route.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`
  - Cover current-entry tagging and preview truncation behavior.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-recovery.ts`
  - Derive retryable payload and recovery action visibility from message state.
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`
  - Cover retryable last-user-message detection and stop/retry visibility.

### UI components and styling

- Create: `wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue`
  - Render history as a drawer overlay inside the panel instead of replacing the message region.
- Modify: `wiki/docs/.vitepress/theme/components/AIChatWelcome.vue`
  - Accept precomputed suggestions and grounding hint instead of hardcoded strings.
- Modify: `wiki/docs/.vitepress/theme/components/AIChatSources.vue`
  - Render a visible source summary strip and page-only source cards for public wiki.
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`
  - Consume all new helper models, add the composer status row and recovery actions, and integrate the history drawer.
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css`
  - Add status row, summary strip, drawer, and recovery action styles without regressing existing spacing or markdown rendering.
- Modify: `wiki/docs/.vitepress/theme/types/index.ts`
  - Add any small helper-facing exported types only if extraction becomes clearer with shared interfaces.

### Verification notes

- The wiki package currently has pre-existing unrelated `vue-tsc` failures. Do not treat a non-zero `pnpm --dir wiki run type-check` exit as an automatic regression.
- Use `docs:build` as the primary full-package compile check.
- Use targeted `node:test` coverage for the new helper files as the main TDD loop.

## Chunk 1: Welcome and Composer State

### Task 1: Extract page-aware welcome-state logic with tests

**Files:**
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-welcome.ts`
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`
- Modify: `wiki/docs/.vitepress/theme/components/AIChatWelcome.vue`
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`

- [ ] **Step 1: Write the failing welcome-state tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAiChatWelcomeState } from "./ai-chat-welcome";

test("buildAiChatWelcomeState derives page-aware suggestions from the current title", () => {
  const result = buildAiChatWelcomeState({
    pageTitle: "Quick Start",
    hasCurrentPageContext: true,
    mayRetrieveRelatedPages: true,
  });

  assert.deepEqual(result.suggestions, [
    "总结 Quick Start 的核心内容",
    "提取 Quick Start 里的关键步骤",
    "Quick Start 提到了哪些相关文档或资源",
  ]);
  assert.equal(result.groundingHint, "优先基于当前页面回答，必要时补充相关公开文档");
});

test("buildAiChatWelcomeState falls back to generic prompts without a page title", () => {
  const result = buildAiChatWelcomeState({
    pageTitle: "",
    hasCurrentPageContext: false,
    mayRetrieveRelatedPages: true,
  });

  assert.deepEqual(result.suggestions, [
    "总结这页的核心内容",
    "提取这页里的关键步骤",
    "这页提到了哪些相关文档或资源",
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`

Expected: FAIL because `buildAiChatWelcomeState` does not exist yet.

- [ ] **Step 3: Implement the minimal welcome-state helper**

```ts
export interface AiChatWelcomeState {
  suggestions: string[];
  groundingHint?: string;
}

export function buildAiChatWelcomeState(input: {
  pageTitle?: string;
  hasCurrentPageContext: boolean;
  mayRetrieveRelatedPages: boolean;
}): AiChatWelcomeState {
  // trim title, build title-aware prompts, then derive the shortest honest hint
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`

Expected: PASS with page-aware and generic welcome-state coverage.

- [ ] **Step 5: Wire the helper into `AIChatWelcome.vue` and `AIChat.vue`**

Implement these changes:
- remove the hardcoded `suggestions` array from `AIChatWelcome.vue`
- make `AIChatWelcome.vue` accept `suggestions` and `groundingHint` props
- in `AIChat.vue`, compute `welcomeState` from `pageTitle` and pass it down
- keep the empty-state CTA flow unchanged: clicking a suggestion still calls `@ask`

- [ ] **Step 6: Run the docs build smoke test**

Run: `pnpm --dir wiki run docs:build`

Expected: PASS and include the updated `AIChatWelcome` prop contract without VitePress compile errors.

- [ ] **Step 7: Commit**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-welcome.ts wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts wiki/docs/.vitepress/theme/components/AIChatWelcome.vue wiki/docs/.vitepress/theme/components/AIChat.vue
git commit -m "feat: add page-aware AI chat welcome state"
```

### Task 2: Extract composer status and recovery models with tests

**Files:**
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-status.ts`
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts`
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-recovery.ts`
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css`

- [ ] **Step 1: Write the failing status and recovery tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAiChatComposerStatus } from "./ai-chat-status";
import { getAiChatRecoveryState } from "./ai-chat-recovery";

test("buildAiChatComposerStatus prioritizes loading over all other footer states", () => {
  const result = buildAiChatComposerStatus({
    pageTitle: "Quick Start",
    isLoading: true,
    error: null,
    pendingImageCount: 2,
    inputText: "question",
  });

  assert.deepEqual(result, {
    mode: "loading",
    label: "正在生成回答...",
    showShortcutHint: false,
  });
});

test("buildAiChatComposerStatus shows image count before generic page-context text", () => {
  const result = buildAiChatComposerStatus({
    pageTitle: "Quick Start",
    isLoading: false,
    error: null,
    pendingImageCount: 2,
    inputText: "",
  });

  assert.equal(result.mode, "image-ready");
  assert.equal(result.label, "已附加 2 张图片");
});

test("getAiChatRecoveryState exposes retry only after failure", () => {
  const result = getAiChatRecoveryState({
    isLoading: false,
    error: "发送失败，请重试",
    messages: [
      { id: "u1", role: "user", content: "帮我总结", timestamp: 1 },
      { id: "a1", role: "assistant", content: "", timestamp: 2 },
    ],
  });

  assert.equal(result.canRetry, true);
  assert.equal(result.canStop, false);
  assert.equal(result.retryMessage?.content, "帮我总结");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`

Expected: FAIL because the status and recovery helpers do not exist yet.

- [ ] **Step 3: Implement the minimal helpers**

```ts
export interface AiChatComposerStatus {
  mode: "idle" | "image-ready" | "loading" | "error";
  label: string;
  showShortcutHint: boolean;
}

export function buildAiChatComposerStatus(input: {
  pageTitle?: string;
  isLoading: boolean;
  error: string | null;
  pendingImageCount: number;
  inputText: string;
}): AiChatComposerStatus {
  // loading > error > images > page context > empty idle
}
```

```ts
export function getAiChatRecoveryState(input: {
  isLoading: boolean;
  error: string | null;
  messages: ChatMessage[];
}) {
  // find the latest retryable user message and derive canStop/canRetry
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`

Expected: PASS with loading, image-ready, error, and retryable-message coverage.

- [ ] **Step 5: Integrate status and recovery into the composer**

Implement these changes in `AIChat.vue`:
- compute `composerStatus` and `recoveryState`
- replace the always-on shortcut sentence with a dynamic status row
- show shortcut help only when `composerStatus.showShortcutHint === true`
- add an explicit text action row near the composer:
  - `停止生成` when `recoveryState.canStop === true`
  - `重试` when `recoveryState.canRetry === true`
- keep the existing sender `@cancel="abort"` behavior, but do not rely on it as the only visible stop affordance

Implement these style changes in `ai-chat.css`:
- add `.ai-chat-status-row`
- add `.ai-chat-status-actions`
- add low-emphasis helper text styling for shortcuts
- visually tie error/recovery messaging to the composer area rather than floating independently

- [ ] **Step 6: Run the docs build smoke test**

Run: `pnpm --dir wiki run docs:build`

Expected: PASS with the new footer status and recovery UI.

- [ ] **Step 7: Commit**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-status.ts wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/styles/ai-chat.css
git commit -m "feat: add ai chat composer status and recovery actions"
```

## Chunk 2: Source Trust and History Flow

### Task 3: Extract public-wiki source summary logic with tests

**Files:**
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-sources.ts`
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`
- Modify: `wiki/docs/.vitepress/theme/components/AIChatSources.vue`
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css`

- [ ] **Step 1: Write the failing source-summary tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAiChatSourceViewModel } from "./ai-chat-sources";

test("buildAiChatSourceViewModel reports current-page-only grounding", () => {
  const result = buildAiChatSourceViewModel({
    routePath: "/zh/docs/wiki/quick-start",
    citations: [
      { sourceType: "page", title: "Quick Start", pageSlugId: "quick-start", spaceSlug: "wiki" },
    ],
    fallbackSources: [],
  });

  assert.equal(result.summary, "答案仅基于当前页面");
  assert.equal(result.items[0].badge, "当前页面");
});

test("buildAiChatSourceViewModel keeps page sources visible and hides asset-only cards in public wiki", () => {
  const result = buildAiChatSourceViewModel({
    routePath: "/zh/docs/wiki/quick-start",
    citations: [
      { sourceType: "attachment", title: "manual.pdf", attachmentId: "att-1", spaceSlug: "wiki" },
    ],
    fallbackSources: [],
  });

  assert.equal(result.summary, "");
  assert.deepEqual(result.items, []);
});

test("buildAiChatSourceViewModel summarizes current page plus related pages", () => {
  const result = buildAiChatSourceViewModel({
    routePath: "/zh/docs/wiki/quick-start",
    citations: [
      { sourceType: "page", title: "Quick Start", pageSlugId: "quick-start", spaceSlug: "wiki" },
      { sourceType: "page", title: "Deployment", pageSlugId: "deployment", spaceSlug: "wiki" },
      { sourceType: "page", title: "FAQ", pageSlugId: "faq", spaceSlug: "wiki" },
    ],
    fallbackSources: [],
  });

  assert.equal(result.summary, "答案基于当前页面与 2 篇相关文档");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`

Expected: FAIL because the source view-model helper does not exist yet.

- [ ] **Step 3: Implement the minimal source helper**

```ts
export interface AiChatSourceItem {
  key: string;
  title: string;
  href: string;
  badge: "当前页面" | "相关文档";
}

export interface AiChatSourceViewModel {
  summary: string;
  items: AiChatSourceItem[];
}

export function buildAiChatSourceViewModel(...) {
  // keep page citations only, identify current page from route slug, then derive summary text
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`

Expected: PASS with current-page, related-page, and asset-only public-wiki cases covered.

- [ ] **Step 5: Integrate the source summary strip into `AIChatSources.vue`**

Implement these changes:
- replace inline normalization logic with `buildAiChatSourceViewModel(...)`
- render the summary line before the disclosure button
- keep the disclosure collapsed by default
- render a small badge per source card:
  - `当前页面`
  - `相关文档`
- if `items.length === 0`, render nothing

Style updates in `ai-chat.css`:
- add `.ai-chat-sources-summary`
- add badge styling for source cards
- keep the source module quieter than the answer body

- [ ] **Step 6: Run the docs build smoke test**

Run: `pnpm --dir wiki run docs:build`

Expected: PASS with the stronger source trust UI.

- [ ] **Step 7: Commit**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-sources.ts wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts wiki/docs/.vitepress/theme/components/AIChatSources.vue wiki/docs/.vitepress/theme/styles/ai-chat.css
git commit -m "feat: add ai chat source summary strip"
```

### Task 4: Replace the full-screen history mode switch with an in-panel history drawer

**Files:**
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-history.ts`
- Create: `wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`
- Create: `wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue`
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css`
- Modify: `wiki/docs/.vitepress/theme/types/index.ts`

- [ ] **Step 1: Write the failing history helper tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAiChatHistoryDrawerItems } from "./ai-chat-history";

test("buildAiChatHistoryDrawerItems marks the current route", () => {
  const result = buildAiChatHistoryDrawerItems({
    currentRoutePath: "/zh/docs/wiki/quick-start",
    entries: [
      {
        routePath: "/zh/docs/wiki/quick-start",
        pageTitle: "Quick Start",
        lastMessage: "帮我总结",
        messageCount: 2,
        updatedAt: 1,
      },
    ],
  });

  assert.equal(result[0].isCurrent, true);
});

test("buildAiChatHistoryDrawerItems trims noisy previews", () => {
  const result = buildAiChatHistoryDrawerItems({
    currentRoutePath: "/zh/docs/wiki/quick-start",
    entries: [
      {
        routePath: "/zh/docs/wiki/deployment",
        pageTitle: "Deployment",
        lastMessage: "a".repeat(200),
        messageCount: 4,
        updatedAt: 1,
      },
    ],
  });

  assert.equal(result[0].preview.length <= 80, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`

Expected: FAIL because the history drawer helper does not exist yet.

- [ ] **Step 3: Implement the minimal history helper**

```ts
export interface AiChatHistoryDrawerItem extends HistoryEntry {
  isCurrent: boolean;
  preview: string;
}

export function buildAiChatHistoryDrawerItems(input: {
  currentRoutePath: string;
  entries: HistoryEntry[];
}): AiChatHistoryDrawerItem[] {
  // annotate current item and clamp preview text for drawer layout stability
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`

Expected: PASS with current-route marking and preview clamping covered.

- [ ] **Step 5: Implement `AIChatHistoryDrawer.vue` and integrate it**

Implement these changes:
- create `AIChatHistoryDrawer.vue` with props:
  - `open`
  - `entries`
  - `currentRoutePath`
- expose events:
  - `close`
  - `select`
- render the drawer on top of the existing message region instead of replacing it
- keep the current conversation visible underneath while the drawer is open
- in `AIChat.vue`, replace `v-if="!showHistory"` / `v-else` full-region switching with:
  - always-rendered message region
  - conditionally rendered drawer overlay

Style updates in `ai-chat.css`:
- add absolute-positioned drawer container and backdrop within the panel
- preserve pointer safety and keyboard-accessible close affordances
- keep the existing history list card styles, but scope them inside the drawer

- [ ] **Step 6: Run the docs build smoke test**

Run: `pnpm --dir wiki run docs:build`

Expected: PASS with the drawer integrated and no VitePress SFC compile errors.

- [ ] **Step 7: Commit**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-history.ts wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/styles/ai-chat.css wiki/docs/.vitepress/theme/types/index.ts
git commit -m "feat: move ai chat history into a drawer overlay"
```

## Chunk 3: Final Integration and Regression Checks

### Task 5: Tighten recovery wiring and finish regression coverage

**Files:**
- Modify: `wiki/docs/.vitepress/theme/components/AIChat.vue`
- Modify: `wiki/docs/.vitepress/theme/styles/ai-chat.css`
- Modify if needed: `wiki/docs/.vitepress/theme/types/index.ts`

- [ ] **Step 1: Write the last failing recovery regression test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { getAiChatRecoveryState } from "./utils/ai-chat-recovery";

test("getAiChatRecoveryState does not expose retry while a response is streaming", () => {
  const result = getAiChatRecoveryState({
    isLoading: true,
    error: null,
    messages: [
      { id: "u1", role: "user", content: "继续", timestamp: 1 },
      { id: "a1", role: "assistant", content: "", timestamp: 2, isStreaming: true },
    ],
  });

  assert.equal(result.canStop, true);
  assert.equal(result.canRetry, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail if this case is still missing**

Run: `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`

Expected: FAIL if stop/retry precedence is not implemented correctly yet.

- [ ] **Step 3: Finish the recovery wiring in `AIChat.vue`**

Implement these changes:
- make `retry()` reuse `recoveryState.retryMessage` instead of scanning ad hoc
- ensure `abort()` clears only the streaming assistant placeholder and does not create a false error
- ensure footer actions reflect the same underlying recovery model used by the helper tests
- keep the existing `saveHistory()` behavior unchanged for completed messages only

- [ ] **Step 4: Run the helper test suite**

Run:

```bash
pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts
```

Expected: PASS for all new AI chat helper tests.

- [ ] **Step 5: Run the package build**

Run: `pnpm --dir wiki run docs:build`

Expected: PASS.

- [ ] **Step 6: Run the package type-check and isolate touched-file regressions**

Run:

```powershell
pnpm --dir wiki run type-check 2>&1 | Tee-Object -FilePath .tmp-wiki-ai-chat-typecheck.log
rg "AIChat|AIChatSources|AIChatWelcome|AIChatHistoryDrawer|ai-chat-(welcome|status|sources|history|recovery)" .tmp-wiki-ai-chat-typecheck.log
```

Expected:
- first command may still exit non-zero because of pre-existing unrelated wiki issues
- second command prints no matches from newly touched AI chat files

- [ ] **Step 7: Run manual UI verification**

Run the wiki locally and verify:

1. Open a doc page and open `AI Ask`.
2. Confirm welcome suggestions include the page title.
3. Send a prompt and confirm the status row changes to `正在生成回答...`.
4. Confirm source summary appears before expanding sources.
5. Open history and confirm the current chat remains visible beneath the drawer.
6. Trigger a failed request and confirm `重试` appears.
7. Start a streaming answer and confirm `停止生成` appears instead of `重试`.

Suggested command: `pnpm --dir wiki run docs:dev`

- [ ] **Step 8: Commit**

```bash
git add wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/styles/ai-chat.css wiki/docs/.vitepress/theme/types/index.ts wiki/docs/.vitepress/theme/utils/ai-chat-*.ts wiki/docs/.vitepress/theme/utils/ai-chat-*.test.ts wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue
git commit -m "feat: polish wiki ai chat interactions"
```

## Local Review Notes

- Keep this phase frontend-first. Do not expand into new SSE event types or backend retrieval-progress plumbing unless an additive field becomes truly necessary.
- Preserve the current public wiki rule that the visible source UI shows page sources only. Asset citations may still exist in backend data for answer generation, but they must not become visible cards here.
- Avoid opportunistic refactors to unrelated theme files while touching `AIChat.vue`.
- If `types/index.ts` needs shared helper types, add only the smallest shared types used by multiple files.

## Plan Review Checklist

Use this checklist for local review before executing the plan:

- no task requires a new backend contract unless explicitly called out as additive
- every new helper has a matching `node:test` file
- every UI integration task has a `docs:build` verification step
- the pre-existing wiki `type-check` failures are documented so execution does not block on unrelated errors
- visible source cards remain page-only in public wiki

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-23-wiki-ai-chat-ux-polish-implementation.md`. Ready to execute.
