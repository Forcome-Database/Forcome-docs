# AI 写作面板 UI/UX 重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 降低 AI 写作面板信息密度，实现阶段感知卡片显隐、Agent 步骤人类可读化、Brief 自动确认、Review 自动通过，以及 DocumentTaskHeader 布局优化。

**Architecture:** 在 DocumentOperationCenter 中引入 phase 计算逻辑控制子组件显隐；TaskActivityFeed 消除"Latest update"冗余并增加经过时间；SmartBriefCard 增加自动确认倒计时；awaitInput phase=review 时无 blocking issue 自动 resume。

**Tech Stack:** React 18 + Mantine + Jotai + react-i18next + useInterval

**Spec:** `docs/superpowers/specs/2026-03-26-ai-writing-comprehensive-improvement-design.md` Section 3

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx:48-52` | formatDocumentTaskMode 友好映射 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx:84-115` | 三列→Badge 列表 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/document-task/TaskActivityFeed.tsx:40-64,109-138` | 人类可读步骤名+去冗余+经过时间 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx:78-134` | 阶段感知卡片显隐 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx:20` | i18n 修复 |

---

## Task 1: DocumentTaskHeader 布局优化 + formatDocumentTaskMode

**背景：** 三列 `Group grow` 在 380px 面板中会截断文本。`formatDocumentTaskMode` 直接返回原始枚举值。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx:48-52`
- 修改: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx:84-115`

- [ ] **Step 1: 修复 formatDocumentTaskMode**

在 `ai-creator-panel.tsx` 第 48-52 行，将：
```typescript
function formatDocumentTaskMode(
  mode: "strict_preservation" | "relaxed_optimization",
): string {
  return mode;
}
```
替换为：
```typescript
function formatDocumentTaskMode(
  mode: "strict_preservation" | "relaxed_optimization",
): string {
  const modeMap: Record<string, string> = {
    strict_preservation: "Strict",
    relaxed_optimization: "Creative",
  };
  return modeMap[mode] ?? mode;
}
```

- [ ] **Step 2: 修改 DocumentTaskHeader 为 Badge 列表**

在 `DocumentTaskHeader.tsx` 第 84-115 行，将三列 `<Group grow>` 布局替换为单行 Badge 列表：

```tsx
<Group gap="xs" wrap="wrap">
  <Badge variant="light" color={statusColor} size="sm">
    {statusLabel}
  </Badge>
  <Badge variant="outline" color="gray" size="sm">
    {sourceScopeLabel}
  </Badge>
  <Badge variant="outline" color="gray" size="sm">
    {modeLabel}
  </Badge>
</Group>
```

需要先读取完整文件确认 `statusLabel`、`sourceScopeLabel`、`modeLabel` 的变量名和 `statusColor` 的计算方式。保留现有的标签映射逻辑，只改布局。

- [ ] **Step 3: TypeScript 编译检查**

```bash
cd apps/client && npx tsc --noEmit 2>&1 | grep -i "error" | head -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx
git commit -m "fix(ux): compact DocumentTaskHeader to Badge list and add friendly mode labels"
```

---

## Task 2: TaskActivityFeed 人类可读化 + 去冗余 + 经过时间

**背景：** "Latest update" 高亮卡片和时间线最后一步重复；步骤名称不够友好；无经过时间显示。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/document-task/TaskActivityFeed.tsx`

- [ ] **Step 1: 扩展 formatStepLabel 映射**

在 `TaskActivityFeed.tsx` 第 40-64 行的 `formatStepLabel` 函数中，扩展映射并添加动态 section 匹配：

```typescript
function formatStepLabel(
  step: AgentStepInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (step.description?.trim()) {
    return step.description;
  }
  // Dynamic section matching
  if (step.step?.startsWith("write_section")) {
    const num = step.step.replace(/write_section_?/, "");
    return t("Writing section {{num}}", { num: num || "" });
  }
  switch (step.step) {
    case "parse_assets":
      return t("Reading your source files");
    case "preservation_patch":
      return t("Preserving original formatting");
    case "create_brief":
      return t("Understanding your goals");
    case "create_blueprint":
      return t("Planning document structure");
    case "review":
      return t("Checking quality");
    case "finalize":
      return t("Preparing final draft");
    case "research":
      return t("Researching online sources");
    case "simple_edit":
      return t("Editing content");
    default:
      return step.step?.replace(/_/g, " ") ?? t("Processing");
  }
}
```

- [ ] **Step 2: 消除 "Latest update" 冗余卡片**

删除第 109-138 行的独立 "Latest update" Paper 卡片。改为在时间线的最后一项上加强视觉权重（加粗 + 蓝色左边框）：

在时间线渲染列表中，对最后一项（`index === visibleSteps.length - 1`）添加特殊样式：

```tsx
<Box
  key={step.stepId}
  style={{
    borderLeft: index === visibleSteps.length - 1 ? "3px solid var(--mantine-color-blue-5)" : undefined,
    paddingLeft: index === visibleSteps.length - 1 ? 8 : undefined,
  }}
>
```

- [ ] **Step 3: 添加经过时间显示**

在每个步骤渲染中，添加经过时间计算和显示：

```tsx
function formatElapsed(startTime?: number): string {
  if (!startTime) return "";
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}

// 在组件中使用 useInterval 每秒更新
import { useInterval } from "@mantine/hooks";
const [, setTick] = useState(0);
const interval = useInterval(() => setTick((t) => t + 1), 1000);

useEffect(() => {
  const hasRunning = steps.some((s) => s.status === "running");
  if (hasRunning) interval.start();
  else interval.stop();
  return interval.stop;
}, [steps]);
```

在每个步骤的 Badge 旁边显示经过时间：

```tsx
<Group gap="xs">
  <Badge color={statusColor(step.status)} variant="light" size="xs">
    {formatStatusLabel(step.status, t)}
  </Badge>
  {step.startTime && (
    <Text size="xs" c="dimmed">{formatElapsed(step.startTime)}</Text>
  )}
</Group>
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd apps/client && npx tsc --noEmit 2>&1 | grep -i "error" | head -5
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/document-task/TaskActivityFeed.tsx
git commit -m "fix(ux): improve TaskActivityFeed with readable labels, elapsed time, remove duplicate card"
```

---

## Task 3: 阶段感知卡片显隐

**背景：** DocumentOperationCenter 同时渲染所有子组件。应根据当前阶段只显示相关卡片。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx:78-134`

- [ ] **Step 1: 读取当前文件**

读取 `DocumentOperationCenter.tsx` 完整内容。

- [ ] **Step 2: 添加阶段计算逻辑**

在组件顶部添加阶段推断：

```tsx
// Compute current phase from props
type Phase = "preparing" | "confirming" | "delivering";

const currentPhase = useMemo<Phase>(() => {
  if (status === "idle" || status === "running") {
    // If brief is being awaited, we're in confirming phase
    if (brief && onConfirmBrief) return "confirming";
    // If blueprint or review is ready, we're in confirming phase
    if (onOpenBlueprint || onOpenReview) return "confirming";
    return "preparing";
  }
  if (status === "awaiting_input") return "confirming";
  if (status === "completed" || status === "error") return "delivering";
  return "preparing";
}, [status, brief, onConfirmBrief, onOpenBlueprint, onOpenReview]);
```

- [ ] **Step 3: 添加 3 阶段指示器**

在子组件渲染之前添加 Badge 列表指示器：

```tsx
import { Badge, Group } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";

<Group gap={4} justify="center" mb="sm">
  <Badge
    variant={currentPhase === "preparing" ? "filled" : "light"}
    color={currentPhase === "preparing" ? "blue" : "gray"}
    size="sm"
  >
    {t("Preparing")}
  </Badge>
  <IconChevronRight size={12} color="gray" />
  <Badge
    variant={currentPhase === "confirming" ? "filled" : "light"}
    color={currentPhase === "confirming" ? "blue" : "gray"}
    size="sm"
  >
    {t("Confirming")}
  </Badge>
  <IconChevronRight size={12} color="gray" />
  <Badge
    variant={currentPhase === "delivering" ? "filled" : "light"}
    color={currentPhase === "delivering" ? "blue" : "gray"}
    size="sm"
  >
    {t("Delivering")}
  </Badge>
</Group>
```

- [ ] **Step 4: 按阶段控制子组件显隐**

修改子组件渲染条件：

```tsx
{/* Preparing phase: only show activity feed */}
{currentPhase === "preparing" && (
  <TaskActivityFeed steps={steps} defaultExpanded={defaultExpanded} />
)}

{/* Confirming phase: show brief/blueprint/review controls */}
{currentPhase === "confirming" && (
  <>
    {brief && onConfirmBrief && (
      <SmartBriefCard brief={brief} assetSummary={assetSummary} onConfirm={onConfirmBrief} />
    )}
    {(onOpenBlueprint || onOpenReview) && (
      /* blueprint/review buttons */
    )}
    {expertCollab && onConfirmExpertCollab && (
      <ExpertCollabPanel ... />
    )}
    <TaskActivityFeed steps={steps} defaultExpanded={false} />
  </>
)}

{/* Delivering phase: show diff, pending changes, activity */}
{currentPhase === "delivering" && (
  <>
    <DiffReviewPanel ... />
    <PendingChangeBar ... />
    <TaskActivityFeed steps={steps} defaultExpanded={false} />
  </>
)}
```

保留 `DocumentTaskHeader` 在所有阶段都可见。

- [ ] **Step 5: TypeScript 编译检查**

```bash
cd apps/client && npx tsc --noEmit 2>&1 | grep -i "error" | head -5
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx
git commit -m "feat(ux): implement phase-aware card visibility in DocumentOperationCenter"
```

---

## Task 4: i18n 修复

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx:20`

- [ ] **Step 1: 修复硬编码中文**

在 `ai-creator-agent-steps.tsx` 第 20 行，将 `执行步骤` 替换为 `t("Execution steps")`。确认文件已导入 `useTranslation`，如果没有则添加。

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx
git commit -m "fix(i18n): replace hardcoded Chinese in AiCreatorAgentSteps"
```

---

## 验收检查

```bash
# TypeScript 全量编译
cd apps/client && npx tsc --noEmit
# 预期: 0 errors

# 确认无硬编码中文（排除 locales 和 test 文件）
grep -rn "执行步骤" apps/client/src/ee/ai/ --include="*.tsx" --include="*.ts"
# 预期: 无结果
```
