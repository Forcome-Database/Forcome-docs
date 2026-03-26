# AI 写作前端 UX 优化计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升 AI 助手面板可发现性、修复国际化缺陷、清理废弃组件、修复错误处理静默问题，并完善 formatDocumentTaskMode 映射。

**Architecture:** 在编辑器工具栏新增 AI 按钮触发侧边栏；注册全局快捷键；对所有硬编码中文字符串添加 i18n key；删除未使用的 `AiCreatorInputV2`；修复 `EditorAiMenu` 静默失败问题。

**Tech Stack:** React 18 + Jotai + Mantine + TipTap + react-i18next

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 验证+修改 | `apps/client/src/features/page/components/header/page-header-menu.tsx:82-91` | 验证现有 AI 按钮 + 添加快捷键 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx:21` | i18n |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx` | i18n |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx` | i18n |
| 修改 | `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx:127-129` | 错误通知 |
| 删除 | `apps/client/src/ee/ai/components/ai-creator/input/AiCreatorInputV2.tsx` | 删除废弃组件 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx:48-51` | formatDocumentTaskMode |
| 新增 | `apps/client/public/locales/zh-CN/translation.json`（相关 key） | 中文翻译 |
| 新增 | `apps/client/public/locales/en-US/translation.json`（相关 key） | 英文翻译 |

---

## Task 1: 验证 AI 面板入口并添加键盘快捷键

**背景：** `page-header-menu.tsx` 第 82-91 行**已有** `IconSparkles` AI 按钮（通过 `toggleAside("ai-creator")`），面板入口已实现。本 Task 仅验证其正常运作，并补充缺失的键盘快捷键 `Mod+Shift+A`。

**Files:**
- 验证+修改: `apps/client/src/features/page/components/header/page-header-menu.tsx:82-91`

- [ ] **Step 1: 确认现有 AI 按钮存在且使用 toggleAside**

```bash
grep -n "ai-creator\|IconSparkles\|toggleAside" \
  apps/client/src/features/page/components/header/page-header-menu.tsx
# 预期：找到 toggleAside("ai-creator") 和 IconSparkles
```

确认 onClick 调用的是 `toggleAside("ai-creator")`（支持二次点击关闭），而非 `setAsideState`（只能打开，无法关闭）。若错误使用 `setAsideState`，修改为 `toggleAside`。

- [ ] **Step 2: 检查文件中现有 useHotkeys 用法**

```bash
grep -n "useHotkeys\|mod+" \
  apps/client/src/features/page/components/header/page-header-menu.tsx
```

- [ ] **Step 3: 添加 Mod+Shift+A 快捷键**

在 `page-header-menu.tsx` 中找到 `useHotkeys` 数组（已有 `mod+f` 等），追加：

```typescript
['mod+shift+a', () => toggleAside('ai-creator')],
```

若文件中尚无 `useHotkeys`，在组件内添加：

```typescript
import { useHotkeys } from '@mantine/hooks';

// 组件内（toggleAside 已在组件作用域中可用）：
useHotkeys([
  ['mod+shift+a', () => toggleAside('ai-creator')],
]);
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd apps/client && pnpm tsc --noEmit 2>&1 | grep "page-header-menu"
# 预期：无错误
```

- [ ] **Step 5: 本地验证**

```bash
pnpm dev
```

在编辑器页面中：
1. 点击页面顶部工具栏的 `✨` 按钮 → 面板打开
2. 再次点击 → 面板关闭（toggle 行为）
3. 按 `Ctrl+Shift+A`（Mac: `Cmd+Shift+A`）→ 面板打开/关闭

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/features/page/components/header/page-header-menu.tsx
git commit -m "feat(ux): add Mod+Shift+A keyboard shortcut to toggle AI Creator panel"
```

---

## Task 2: 修复 AiCreatorAgentSteps 硬编码中文

**背景：** `ai-creator-agent-steps.tsx` 第 21 行 `"执行步骤"` 硬编码，未经 `useTranslation`。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx:21`
- 修改: `apps/client/public/locales/zh-CN/translation.json`（或对应 ns 文件）
- 修改: `apps/client/public/locales/en-US/translation.json`

- [ ] **Step 1: 查看 i18n namespace 和文件位置**

```bash
# 查看项目使用的 i18n 配置
cat apps/client/src/i18n.ts 2>/dev/null || grep -rn "i18next\|useTranslation" \
  apps/client/src/main.tsx apps/client/src/App.tsx 2>/dev/null | head -10

# 查看已有翻译文件结构（以了解 key 命名规范）
ls apps/client/public/locales/
ls apps/client/public/locales/en/ 2>/dev/null || ls apps/client/public/locales/zh-CN/ 2>/dev/null
```

- [ ] **Step 2: 查看当前 ai-creator-agent-steps.tsx**

```bash
cat -n apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx | head -40
```

- [ ] **Step 3: 修改组件**

```typescript
// ai-creator-agent-steps.tsx — 在组件顶部添加 useTranslation
import { useTranslation } from 'react-i18next';

export function AiCreatorAgentSteps({ ... }) {
  const { t } = useTranslation();
  // ...

  return (
    <div ...>
      <h3>{t('ai.agentSteps.title', 'Execution Steps')}</h3>
      {/* ... */}
    </div>
  );
}
```

- [ ] **Step 4: 添加翻译 key**

在英文翻译文件中添加（具体文件路径根据 Step 1 确认）：
```json
{
  "ai": {
    "agentSteps": {
      "title": "Execution Steps"
    }
  }
}
```

在中文翻译文件中添加：
```json
{
  "ai": {
    "agentSteps": {
      "title": "执行步骤"
    }
  }
}
```

- [ ] **Step 5: TypeScript 编译检查**

```bash
cd apps/client && pnpm tsc --noEmit 2>&1 | grep "ai-creator-agent-steps"
# 预期：无错误
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx
git add apps/client/public/locales/
git commit -m "fix(i18n): replace hardcoded '执行步骤' with t() in AiCreatorAgentSteps"
```

---

## Task 3: 修复 BlueprintModal 硬编码中文字符串

**背景：** `BlueprintModal.tsx` 中多处硬编码中文：`"创作蓝图"`、`"字数"`、`"大纲预览"`、`"确认开始写作"`、`"重新生成"` 等。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`

- [ ] **Step 1: 列出所有硬编码字符串**

```bash
grep -n '"[^"]*[\u4e00-\u9fa5][^"]*"' \
  apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx
```

- [ ] **Step 2: 添加 useTranslation 并替换每个字符串**

参考 Task 2 的模式，对每个硬编码字符串：
1. 确定 i18n key 命名（如 `ai.blueprint.title`、`ai.blueprint.wordCount`）
2. 用 `t('key', 'English fallback')` 替换
3. 在两个翻译文件中添加对应条目

常见字符串及建议 key：
```
"创作蓝图"        → t('ai.blueprint.title', 'Creative Blueprint')
"字数"            → t('ai.blueprint.wordCount', 'Word Count')
"大纲预览"        → t('ai.blueprint.outlinePreview', 'Outline Preview')
"确认开始写作"    → t('ai.blueprint.confirm', 'Confirm and Start Writing')
"重新生成"        → t('ai.blueprint.regenerate', 'Regenerate')
"总计：X 字 / X 章" → t('ai.blueprint.total', 'Total: {{words}} words / {{sections}} sections', { words, sections })
```

- [ ] **Step 3: 更新翻译文件**

在 `en/translation.json` 和 `zh-CN/translation.json` 添加所有 key。

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd apps/client && pnpm tsc --noEmit 2>&1 | grep "BlueprintModal"
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx
git add apps/client/public/locales/
git commit -m "fix(i18n): replace hardcoded Chinese strings in BlueprintModal with t()"
```

---

## Task 4: 修复 ReviewModal 硬编码英文字符串（缺失 i18n）

**背景：** `ReviewModal.tsx` 中所有字符串（`"Quality Review"`、`"Pending decisions"`、`"Fix selected"`等）未经 `t()` 处理，多语言用户看到英文 UI。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`

- [ ] **Step 1: 列出所有硬编码字符串**

```bash
grep -n '"[A-Z][^"]*"' \
  apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx | head -30
```

- [ ] **Step 2: 添加 useTranslation 并替换字符串**

在组件顶部添加：
```typescript
const { t } = useTranslation();
```

常见字符串及建议 key：
```
"Quality Review"              → t('ai.review.title', 'Quality Review')
"Pending decisions ({{n}})"  → t('ai.review.pendingDecisions', 'Pending decisions ({{n}})', { n })
"Select all"                  → t('common.selectAll', 'Select all')
"Clear"                       → t('common.clear', 'Clear')
"Additional fix instructions" → t('ai.review.fixInstructions', 'Additional fix instructions (optional)')
"Continue with current draft" → t('ai.review.continue', 'Continue with current draft')
"Fix selected ({{n}})"        → t('ai.review.fixSelected', 'Fix selected ({{n}})', { n })
"Skip visual blockers"        → t('ai.review.skipVisual', 'Skip visual blockers')
```

- [ ] **Step 3: 更新翻译文件**

在 `en/translation.json` 和 `zh-CN/translation.json` 添加所有 key，中文翻译需提供正确的中文版本。

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx
git add apps/client/public/locales/
git commit -m "fix(i18n): add useTranslation to ReviewModal — all strings now go through t()"
```

---

## Task 5: 修复行内 AI 菜单失败静默关闭问题

**背景：** `EditorAiMenu` 在 AI 请求失败时调用 `resetMenu()` + `setIsLoading(false)`（行 127-129），没有任何错误通知，菜单静默关闭，用户不知道发生了什么。

**Files:**
- 修改: `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx:127-129`

- [ ] **Step 1: 查看当前错误处理代码**

```bash
sed -n '120,140p' apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx
```

- [ ] **Step 2: 添加 Mantine 通知**

找到错误处理分支（`catch` 块或错误回调），添加 `notifications.show`：

```typescript
// 在 catch 块中
import { notifications } from '@mantine/notifications';

// 原来：
// resetMenu();
// setIsLoading(false);

// 修改后：
resetMenu();
setIsLoading(false);
notifications.show({
  color: 'red',
  title: t('ai.error.title', 'AI Error'),
  message: err?.message || t('ai.error.generic', 'Failed to generate AI response. Please try again.'),
  autoClose: 4000,
});
```

确认文件顶部有 `import { notifications } from '@mantine/notifications'` 和 `useTranslation`。

- [ ] **Step 3: 添加翻译 key**

```json
// en/translation.json
{
  "ai": {
    "error": {
      "title": "AI Error",
      "generic": "Failed to generate AI response. Please try again."
    }
  }
}

// zh-CN/translation.json
{
  "ai": {
    "error": {
      "title": "AI 出错",
      "generic": "AI 生成失败，请重试。"
    }
  }
}
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd apps/client && pnpm tsc --noEmit 2>&1 | grep "ai-menu"
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx
git add apps/client/public/locales/
git commit -m "fix(ux): show error notification instead of silently closing AI inline menu on failure"
```

---

## Task 6: 删除废弃的 AiCreatorInputV2 组件

**背景：** `AiCreatorInputV2.tsx` 已实现但未被任何文件引入，与正在使用的 `AiCreatorInput` 平行存在，造成混乱。

**Files:**
- 删除: `apps/client/src/ee/ai/components/ai-creator/input/AiCreatorInputV2.tsx`
- 检查修改: `apps/client/src/ee/ai/components/ai-creator/input/index.ts`

- [ ] **Step 1: 确认无引用**

```bash
grep -rn "AiCreatorInputV2" apps/client/src/ --include="*.tsx" --include="*.ts"
# 预期：只有文件自身，无其他引用
```

- [ ] **Step 2: 检查 index.ts 是否导出了 V2**

```bash
cat apps/client/src/ee/ai/components/ai-creator/input/index.ts
```

若 `index.ts` 导出了 `AiCreatorInputV2`，从导出中删除该行（保留 `AiCreatorInput` 的导出）。

- [ ] **Step 3: 删除文件**

```bash
rm apps/client/src/ee/ai/components/ai-creator/input/AiCreatorInputV2.tsx
```

- [ ] **Step 4: 确认编译无错误**

```bash
cd apps/client && pnpm tsc --noEmit 2>&1 | grep -i "v2\|InputV2"
# 预期：无错误
```

- [ ] **Step 5: Commit**

```bash
git add -A apps/client/src/ee/ai/components/ai-creator/input/
git commit -m "chore: delete unused AiCreatorInputV2 orphan component"
```

---

## Task 7: 实现 formatDocumentTaskMode 正确映射

**背景：** `ai-creator-panel.tsx` 第 48-51 行的 `formatDocumentTaskMode` 直接返回原始字符串，用户可能看到技术字段 `"strict_preservation"` 而非友好文本。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx:48-51`

- [ ] **Step 1: 删除独立函数，改用组件内 useMemo + t()**

当前 `formatDocumentTaskMode` 定义在组件外（第 48-51 行），无法调用 React Hook。直接删除该函数，在 `AiCreatorPanel` 组件内添加：

```typescript
// 在 AiCreatorPanel 组件内，useTranslation 之后
const { t } = useTranslation();

const formattedMode = useMemo(() => {
  const modeMap: Record<string, string> = {
    strict_preservation: t('ai.mode.strictPreservation', 'Precision Edit'),
    relaxed_optimization: t('ai.mode.relaxedOptimization', 'Creative Rewrite'),
  };
  return modeMap[session.documentTask.mode] ?? session.documentTask.mode;
}, [session.documentTask.mode, t]);
```

然后将 JSX 中的 `mode={formatDocumentTaskMode(session.documentTask.mode)}` 替换为 `mode={formattedMode}`，并删除顶部的 `function formatDocumentTaskMode(...)` 函数体。

- [ ] **Step 2: 添加翻译 key**

```json
{
  "ai": {
    "mode": {
      "strictPreservation": "Precision Edit",
      "relaxedOptimization": "Creative Rewrite"
    }
  }
}
```

中文：
```json
{
  "ai": {
    "mode": {
      "strictPreservation": "精确编辑",
      "relaxedOptimization": "创意改写"
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx
git add apps/client/public/locales/
git commit -m "fix(ux): implement formatDocumentTaskMode with friendly labels instead of raw enum values"
```

---

## 验收检查

所有 Task 完成后执行：

```bash
# TypeScript 编译
cd apps/client && pnpm tsc --noEmit
# 预期：0 errors

# 确认废弃文件已删除
ls apps/client/src/ee/ai/components/ai-creator/input/AiCreatorInputV2.tsx 2>/dev/null && echo "ERROR: file still exists"
# 预期：文件不存在

# 检查是否还有硬编码中文字符串（Task 6 必须先完成，避免 AiCreatorInputV2.tsx 产生误报）
# 使用 rg（ripgrep）而非 grep，bash 不支持 \u Unicode 转义
rg --type tsx --type ts -n '[\x{4e00}-\x{9fa5}]' apps/client/src/ee/ai/ \
  --glob '!**/__tests__/**' --glob '!**/locales/**' | head -20
# 预期：只剩注释中的中文，不应有 JSX 属性或字符串字面量中的硬编码中文

# 确认翻译 key 完整（使用 cat+jq，避免 Node.js ESM/CJS 冲突）
cat apps/client/public/locales/en-US/translation.json | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  console.log('ai.agentSteps.title:', d?.ai?.agentSteps?.title); \
  console.log('ai.blueprint.title:', d?.ai?.blueprint?.title); \
  console.log('ai.review.title:', d?.ai?.review?.title); \
  console.log('ai.error.title:', d?.ai?.error?.title);"
```

---

## 执行顺序建议

Task 顺序无强依赖，但建议先执行：
1. Task 6（删除废弃组件，减少干扰）
2. Task 7（修复 formatDocumentTaskMode，最简单）
3. Task 5（错误通知，独立改动）
4. Task 2-4（i18n 系列，可批量处理翻译文件）
5. Task 1（入口按钮，需要了解工具栏结构，最复杂）
