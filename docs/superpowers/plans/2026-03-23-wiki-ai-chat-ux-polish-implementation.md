# Wiki AI Chat UX 润色实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 为公开 wiki `AI Ask` 面板提供前端优先的润色迭代，该面板添加了上下文入门、更清晰的输入区状态模型、更强大的源摘要、非破坏性历史记录抽屉以及更清晰的重试/停止恢复。

**架构：** 保留当前的 `AIChat.vue` 集成和流式协议，但将最高价值的决策逻辑移至小型纯 TypeScript 帮助程序中，这些帮助程序可以通过 `tsx --test` 用 `node:test` 覆盖。 UI 组合保留在 VitePress 主题层中，带有一个新的历史抽屉组件和集中的 CSS 添加，而不是整个面板重写。

**技术栈：** Vue 3 + VitePress 主题组件、TypeScript、`ant-design-x-vue`、`node:test`、`tsx --test`、`vue-tsc`、VitePress 文档构建。

---

## 文件结构

### 经过测试的 UI 视图模型助手

- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-welcome.ts`
  - 构建页面感知的欢迎提示和基础提示字符串。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`
  - 封面页面感知提示生成和通用后备行为。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-status.ts`
  - 根据 `pageTitle`、`isLoading`、`error`、`pendingImageCount` 和输入状态构建 输入区状态行模型。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts`
  - 涵盖空闲、图像就绪、加载和错误状态。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-sources.ts`
  - 将页面引用标准化为可见源卡和公共维基的一行源摘要。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`
  - 涵盖仅当前页面、当前页面加相关页面、仅相关页面和仅资产引用案例。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-history.ts`
  - 标准化抽屉显示的历史条目并标记当前路线。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`
  - 涵盖当前条目标记并预览截断行为。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-recovery.ts`
  - 从消息状态导出可重试的有效负载和恢复操作可见性。
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`
  - 涵盖可重试的最后用户消息检测和停止/重试可见性。

### UI 组件和样式

- 创建：`wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue`
  - 将历史记录渲染为面板内的抽屉覆盖层，而不是替换消息区域。
- 修改：`wiki/docs/.vitepress/theme/components/AIChatWelcome.vue`
  - 接受预先计算的建议和基础提示，而不是硬编码的字符串。
- 修改：`wiki/docs/.vitepress/theme/components/AIChatSources.vue`
  - 为公共维基呈现可见的源摘要条和仅页面源卡。
- 修改：`wiki/docs/.vitepress/theme/components/AIChat.vue`
  - 使用所有新的帮助器模型，添加作曲家状态行和恢复操作，并集成历史抽屉。
- 修改：`wiki/docs/.vitepress/theme/styles/ai-chat.css`
  - 添加状态行、摘要条、抽屉和恢复操作样式，而无需回归现有间距或 Markdown 渲染。
- 修改：`wiki/docs/.vitepress/theme/types/index.ts`
  - 仅当通过共享接口提取变得更加清晰时，才添加任何面向助手的小型导出类型。

### 验证说明

- wiki 包当前存在预先存在的不相关的 `vue-tsc` 故障。不要将非零 `pnpm --dir wiki run type-check` 退出视为自动回归。
- 使用`docs:build`作为主要的全包编译检查。
- 使用新帮助程序文件的目标 `node:test` 覆盖率作为主 TDD 循环。

## 分块 1：欢迎态与输入区状态

### 任务 1：提取页面感知的欢迎态逻辑并补测试

**文件：**
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-welcome.ts`
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`
- 修改：`wiki/docs/.vitepress/theme/components/AIChatWelcome.vue`
- 修改：`wiki/docs/.vitepress/theme/components/AIChat.vue`

- [ ] **第 1 步：编写失败的欢迎状态测试**

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

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`

预期：失败，因为 `buildAiChatWelcomeState` 尚不存在。

- [ ] **第 3 步：实现最小的欢迎状态助手**

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

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts`

预期：通过页面感知和通用欢迎状态覆盖。

- [ ] **第 5 步：将助手连接到 `AIChatWelcome.vue` 和 `AIChat.vue`**

实施这些更改：
- 从 `AIChatWelcome.vue` 中删除硬编码的 `suggestions` 数组
- 让`AIChatWelcome.vue`接受`suggestions`和`groundingHint`道具
- 在`AIChat.vue`中，从`pageTitle`计算`welcomeState`并将其传递下来
- 保持空状态 CTA 流程不变：点击建议仍会调用 `@ask`

- [ ] **第 6 步：运行文档构建冒烟测试**

运行： `pnpm --dir wiki run docs:build`

预期：通过并包含更新的 `AIChatWelcome` 道具合约，没有 VitePress 编译错误。

- [ ] **第 7 步：提交**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-welcome.ts wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts wiki/docs/.vitepress/theme/components/AIChatWelcome.vue wiki/docs/.vitepress/theme/components/AIChat.vue
git commit -m "feat: add page-aware AI chat welcome state"
```

### 任务 2：提取输入区状态与恢复模型并补测试

**文件：**
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-status.ts`
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts`
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-recovery.ts`
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`
- 修改：`wiki/docs/.vitepress/theme/components/AIChat.vue`
- 修改：`wiki/docs/.vitepress/theme/styles/ai-chat.css`

- [ ] **第 1 步：编写失败状态和恢复测试**

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

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`

预期：失败，因为状态和恢复助手尚不存在。

- [ ] **第 3 步：实现最小助手**

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

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`

预期：通过加载、图像就绪、错误和可重试消息覆盖。

- [ ] **第 5 步：将状态和恢复集成到 Composer 中**

在 `AIChat.vue` 中实施这些更改：
- 计算 `composerStatus` 和 `recoveryState`
- 用动态状态行替换永远在线的快捷语句
- 仅当 `composerStatus.showShortcutHint === true` 时显示快捷方式帮助
- 在作曲家附近添加显式文本操作行：
  - `停止生成` when `recoveryState.canStop === true`
  - `重试` when `recoveryState.canRetry === true`
- 保留现有的发送者 `@cancel="abort"` 行为，但不要依赖它作为唯一可见的停止功能

在 `ai-chat.css` 中实现这些样式更改：
- add `.ai-chat-status-row`
- add `.ai-chat-status-actions`
- 为快捷方式添加低强调帮助文本样式
- 在视觉上将错误/恢复消息传递到作曲家区域，而不是独立浮动

- [ ] **第 6 步：运行文档构建冒烟测试**

运行： `pnpm --dir wiki run docs:build`

预期：通过新的页脚状态和恢复 UI。

- [ ] **第 7 步：提交**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-status.ts wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/styles/ai-chat.css
git commit -m "feat: add ai chat composer status and recovery actions"
```

## 分块 2：来源可信度与历史流转

### 任务 3：提取公开 wiki 来源摘要逻辑并补测试

**文件：**
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-sources.ts`
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`
- 修改：`wiki/docs/.vitepress/theme/components/AIChatSources.vue`
- 修改：`wiki/docs/.vitepress/theme/styles/ai-chat.css`

- [ ] **第 1 步：编写失败的源代码摘要测试**

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

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`

预期：失败，因为源视图模型帮助器尚不存在。

- [ ] **第 3 步：实现最小源助手**

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

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts`

预期：通过，涵盖当前页面、相关页面和仅限资产的公开 wiki 案例。

- [ ] **第 5 步：将源摘要条集成到 `AIChatSources.vue`**

实施这些更改：
- 用 `buildAiChatSourceViewModel(...)` 替换内联标准化逻辑
- 在披露按钮之前呈现摘要行
- 默认情况下将披露折叠起来
- 为每个源卡渲染一个小徽章：
  - `当前页面`
  - `相关文档`
- 如果 `items.length === 0`，则不渲染任何内容

`ai-chat.css` 中的样式更新：
- add `.ai-chat-sources-summary`
- 为源卡添加徽章样式
- 保持源模块比答案主体更安静

- [ ] **第 6 步：运行文档构建冒烟测试**

运行： `pnpm --dir wiki run docs:build`

预期：通过更强大的源信任 UI。

- [ ] **第 7 步：提交**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-sources.ts wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts wiki/docs/.vitepress/theme/components/AIChatSources.vue wiki/docs/.vitepress/theme/styles/ai-chat.css
git commit -m "feat: add ai chat source summary strip"
```

### 任务 4：用面板内历史抽屉替换全屏历史模式切换

**文件：**
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-history.ts`
- 创建：`wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`
- 创建：`wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue`
- 修改：`wiki/docs/.vitepress/theme/components/AIChat.vue`
- 修改：`wiki/docs/.vitepress/theme/styles/ai-chat.css`
- 修改：`wiki/docs/.vitepress/theme/types/index.ts`

- [ ] **第 1 步：编写失败的历史帮助程序测试**

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

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`

预期：失败，因为历史抽屉助手尚不存在。

- [ ] **第 3 步：实现最小历史记录助手**

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

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts`

预期：通过，并覆盖当前路线标记和预览夹紧。

- [ ] **第 5 步：实施 `AIChatHistoryDrawer.vue` 并集成它**

实施这些更改：
- 使用道具创建 `AIChatHistoryDrawer.vue`：
  - `open`
  - `entries`
  - `currentRoutePath`
- 暴露事件：
  - `close`
  - `select`
- 将抽屉呈现在现有消息区域的顶部而不是替换它
- 当抽屉打开时，当前对话在下方可见
- 在 `AIChat.vue` 中，将 `v-if="!showHistory"` / `v-else` 全区域切换替换为：
  - 始终渲染的消息区域
  - 有条件渲染的抽屉覆盖

`ai-chat.css` 中的样式更新：
- 在面板内添加绝对定位的抽屉容器和背景
- 保持指针安全和键盘可访问的近距离功能可供性
- 保留现有的历史列表卡样式，但将它们范围限制在抽屉内

- [ ] **第 6 步：运行文档构建冒烟测试**

运行： `pnpm --dir wiki run docs:build`

预期：通过，抽屉集成且没有 VitePress SFC 编译错误。

- [ ] **第 7 步：提交**

```bash
git add wiki/docs/.vitepress/theme/utils/ai-chat-history.ts wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/styles/ai-chat.css wiki/docs/.vitepress/theme/types/index.ts
git commit -m "feat: move ai chat history into a drawer overlay"
```

## 分块 3：最终集成与回归检查

### 任务 5：收紧恢复链路并完成回归覆盖

**文件：**
- 修改：`wiki/docs/.vitepress/theme/components/AIChat.vue`
- 修改：`wiki/docs/.vitepress/theme/styles/ai-chat.css`
- 如果需要修改：`wiki/docs/.vitepress/theme/types/index.ts`

- [ ] **第 1 步：编写最后一次失败的恢复回归测试**

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

- [ ] **第 2 步：运行测试以验证如果此案例仍然缺失，它们会失败**

运行： `pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts`

预期：如果停止/重试优先级尚未正确实现，则失败。

- [ ] **第 3 步：完成`AIChat.vue`**中的恢复接线

实施这些更改：
- 使`retry()`重用`recoveryState.retryMessage`而不是临时扫描
- 确保 `abort()` 仅清除流媒体助手占位符并且不会产生错误
- 确保页脚操作反映辅助测试使用的相同底层恢复模型
- 仅对于已完成的消息保持现有的 `saveHistory()` 行为不变

- [ ] **第 4 步：运行帮助程序测试套件**

运行：

```bash
pnpm exec tsx --test wiki/docs/.vitepress/theme/utils/ai-chat-welcome.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-status.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-sources.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-history.test.ts wiki/docs/.vitepress/theme/utils/ai-chat-recovery.test.ts
```

预期：通过所有新的人工智能聊天助手测试。

- [ ] **第 5 步：运行包构建**

运行： `pnpm --dir wiki run docs:build`

预期：通过。

- [ ] **第 6 步：运行包类型检查并隔离接触文件回归**

运行：

```powershell
pnpm --dir wiki run type-check 2>&1 | Tee-Object -FilePath .tmp-wiki-ai-chat-typecheck.log
rg "AIChat|AIChatSources|AIChatWelcome|AIChatHistoryDrawer|ai-chat-(welcome|status|sources|history|recovery)" .tmp-wiki-ai-chat-typecheck.log
```

预计：
- 由于预先存在的不相关的 wiki 问题，第一个命令可能仍会以非零值退出
- 第二个命令不会打印新触摸的 AI 聊天文件中的任何匹配项

- [ ] **第 7 步：运行手动 UI 验证**

在本地运行 wiki 并验证：

1. 打开文档页面并打开`AI Ask`。
2. 确认欢迎建议包括页面标题。
3. 发送提示并确认状态行更改为 `正在生成回答...`。
4. 在扩展源之前确认源摘要出现。
5. 打开历史记录并确认当前聊天在抽屉下方仍然可见。
6. 触发失败的请求并确认出现`重试`。
7. 开始串流应答并确认出现 `停止生成` 而不是 `重试`。

建议命令：`pnpm --dir wiki run docs:dev`

- [ ] **第 8 步：提交**

```bash
git add wiki/docs/.vitepress/theme/components/AIChat.vue wiki/docs/.vitepress/theme/styles/ai-chat.css wiki/docs/.vitepress/theme/types/index.ts wiki/docs/.vitepress/theme/utils/ai-chat-*.ts wiki/docs/.vitepress/theme/utils/ai-chat-*.test.ts wiki/docs/.vitepress/theme/components/AIChatHistoryDrawer.vue
git commit -m "feat: polish wiki ai chat interactions"
```

## 本地评审笔记

- 保持此阶段前端优先。除非真正需要附加字段，否则不要扩展到新的 SSE 事件类型或后端检索进度管道。
- 保留当前公开 wiki 规则，即可见源 UI 仅显示页面源。资产引用可能仍然存在于用于生成答案的后端数据中，但它们不得成为此处可见的卡片。
- 避免在接触 `AIChat.vue` 时对不相关的主题文件进行机会性重构。
- 如果 `types/index.ts` 需要共享帮助器类型，则仅添加多个文件使用的最小共享类型。

## 计划审查清单

在executing-plans之前，请使用此清单进行本地审查：

- 没有任务需要新的后端合约，除非明确称为附加合约
- 每个新助手都有一个匹配的 `node:test` 文件
- 每个 UI 集成任务都有一个 `docs:build` 验证步骤
- 记录了预先存在的 wiki `type-check` 失败，因此执行不会因不相关的错误而阻塞
- 可见源卡在公共维基中仅保留页面

## 执行交接

计划已完成并保存至 `docs/superpowers/plans/2026-03-23-wiki-ai-chat-ux-polish-implementation.md`。准备执行。
