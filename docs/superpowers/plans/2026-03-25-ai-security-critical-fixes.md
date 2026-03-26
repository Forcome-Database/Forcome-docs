# AI 写作安全与关键功能修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2 处安全漏洞 + 3 处关键功能缺陷，确保 AI 写作核心链路可靠、安全。

**Architecture:** Python Agent Service 的 `auth.py` 修复空 secret 绕过认证漏洞；NestJS 新增启动告警和输入长度校验；`InlineRewriteService` 接入 `AiService` 实现真实 AI 改写；前端 `AiCreatorPanel` 挂载 `AiCreatorMessages` 恢复消息列表显示。

**Tech Stack:** NestJS 11 + class-validator、Python 3.12 + FastAPI + pydantic-settings、React 18 + Jotai

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `agent-service/app/middleware/auth.py` | 修复空 secret 绕过 |
| 修改 | `agent-service/app/config.py` | 添加 secret 启动警告 |
| 新增 | `agent-service/tests/test_auth_middleware.py` | auth 中间件测试 |
| 修改 | `apps/server/src/integrations/environment/environment.service.ts:430-432` | 添加 secret 启动日志 |
| 修改 | `apps/server/src/ee/ai/dto/ai.dto.ts:22-24` | 添加 `@MaxLength(50000)` |
| 修改 | `apps/server/src/ee/ai/ai.controller.ts:227-236` | 清理 dead code |
| 修改 | `apps/server/src/ee/ai/inline/inline-rewrite.service.ts` | 实现真实 AI 调用 |
| 新增 | `apps/server/src/ee/ai/inline/inline-rewrite.service.spec.ts` | Service 单元测试 |
| 修改 | `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx:226-299` | 挂载 AiCreatorMessages |

---

## Task 1: 修复 Python auth.py 空 secret 绕过漏洞

**背景：** `auth.py` 第 6 行 `request.headers.get("X-Internal-Secret", "")` 当 header 不存在时默认返回 `""`；若 `AGENT_INTERNAL_SECRET` 未配置（默认 `""`），则 `"" != ""` 为 `False`，认证恒通过。

**Files:**
- 新增: `agent-service/tests/test_auth_middleware.py`
- 修改: `agent-service/app/middleware/auth.py`

- [ ] **Step 1: 写失败测试**

```python
# agent-service/tests/test_auth_middleware.py
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException, Request
from app.middleware.auth import verify_internal_secret


def _make_request(secret_header: str | None) -> Request:
    req = MagicMock(spec=Request)
    headers = {}
    if secret_header is not None:
        headers["X-Internal-Secret"] = secret_header
    req.headers = headers
    return req


@pytest.mark.asyncio
async def test_rejects_missing_header():
    """No X-Internal-Secret header → 401"""
    req = _make_request(None)
    with patch("app.middleware.auth.settings") as mock_settings:
        mock_settings.agent_internal_secret = "real-secret"
        with pytest.raises(HTTPException) as exc_info:
            await verify_internal_secret(req)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_empty_header():
    """X-Internal-Secret: '' (empty) → 401"""
    req = _make_request("")
    with patch("app.middleware.auth.settings") as mock_settings:
        mock_settings.agent_internal_secret = ""  # 即使 env 也是空，也应拒绝
        with pytest.raises(HTTPException) as exc_info:
            await verify_internal_secret(req)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_wrong_secret():
    """错误 secret → 401"""
    req = _make_request("wrong")
    with patch("app.middleware.auth.settings") as mock_settings:
        mock_settings.agent_internal_secret = "correct"
        with pytest.raises(HTTPException) as exc_info:
            await verify_internal_secret(req)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_correct_secret():
    """正确 secret → 通过（无异常）"""
    req = _make_request("my-secret")
    with patch("app.middleware.auth.settings") as mock_settings:
        mock_settings.agent_internal_secret = "my-secret"
        await verify_internal_secret(req)  # 不应抛异常
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd agent-service
pytest tests/test_auth_middleware.py -v
# 预期：test_rejects_empty_header FAILED（当前 "" == "" 时通过）
```

- [ ] **Step 3: 修复 auth.py**

```python
# agent-service/app/middleware/auth.py — 完整替换
from fastapi import Request, HTTPException
from app.config import settings


async def verify_internal_secret(request: Request):
    """验证来自 NestJS 网关的内部通信密钥"""
    secret = request.headers.get("X-Internal-Secret")   # None when absent
    if not secret or secret != settings.agent_internal_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
```

- [ ] **Step 4: 运行测试，确认全部 PASS**

```bash
pytest tests/test_auth_middleware.py -v
# 预期：4 passed
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/middleware/auth.py agent-service/tests/test_auth_middleware.py
git commit -m "fix(security): reject empty X-Internal-Secret header in agent-service"
```

---

## Task 2: Python config.py 启动时警告未配置的 secret

**背景：** `agent_internal_secret` 默认 `""` 且不报错，运维人员难以察觉漏配。添加启动警告，不阻断启动（以免影响开发环境）。

**Files:**
- 修改: `agent-service/app/config.py:31`

- [ ] **Step 1: 在 config.py 添加启动检查**

在 `settings = Settings()` 之后添加：

```python
# agent-service/app/config.py — 在文件末尾 settings = Settings() 之后追加

import warnings as _warnings
if not settings.agent_internal_secret:
    _warnings.warn(
        "AGENT_INTERNAL_SECRET is not configured. "
        "The agent-service internal API is open to any caller on the network. "
        "Set AGENT_INTERNAL_SECRET in .env for production deployments.",
        stacklevel=2,
    )
```

- [ ] **Step 2: 同样在 NestJS 侧添加启动日志**

编辑 `apps/server/src/integrations/environment/environment.service.ts` 第 430-432 行：

```typescript
// 替换原来的 getAgentInternalSecret
getAgentInternalSecret(): string {
  const secret = this.configService.get<string>('AGENT_INTERNAL_SECRET') || '';
  if (!secret) {
    this.logger.warn(
      'AGENT_INTERNAL_SECRET is not set. ' +
      'The /api/ai/internal/* endpoints rely on this secret for security.',
    );
  }
  return secret;
}
```

**注意：`EnvironmentService` 当前没有 `Logger` 实例**，必须显式添加，否则 TypeScript 编译报错。在类定义中添加：

```typescript
// apps/server/src/integrations/environment/environment.service.ts
// 在 class EnvironmentService { 之后、constructor 之前添加：
private readonly logger = new Logger(EnvironmentService.name);
```

同时确认文件顶部的 `@nestjs/common` import 中包含 `Logger`：
```typescript
import { Injectable, Logger } from '@nestjs/common';
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/config.py
git add apps/server/src/integrations/environment/environment.service.ts
git commit -m "chore(security): warn on missing AGENT_INTERNAL_SECRET at startup"
```

---

## Task 3: AiGenerateDto 添加输入长度上限

**背景：** `AiGenerateDto.content` 无 `@MaxLength` 限制，用户可提交任意长文本直接进入 LLM prompt，存在 token 超限和费用风险。

**Files:**
- 修改: `apps/server/src/ee/ai/dto/ai.dto.ts:22-24`

- [ ] **Step 1: 修改 DTO**

```typescript
// apps/server/src/ee/ai/dto/ai.dto.ts — 修改 AiGenerateDto
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AiGenerateDto {
  @IsOptional()
  @IsEnum(AiAction)
  action?: AiAction;

  @IsNotEmpty()
  @IsString()
  @MaxLength(50000)  // ← 新增：约 37,500 token，留足模型输出空间
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)   // ← 新增：自定义 prompt 也需上限
  prompt?: string;
}

// AiAnswerDto.query 同样添加上限
export class AiAnswerDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)   // ← 新增
  query: string;
}
```

- [ ] **Step 2: 运行现有测试确认不破坏**

```bash
cd apps/server
pnpm test src/ee/ai/ai.controller.spec.ts --passWithNoTests
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/dto/ai.dto.ts
git commit -m "fix(validation): add MaxLength to AiGenerateDto content and prompt fields"
```

---

## Task 4: 清理 ai.controller.ts 文件上传 dead code

**背景：** `ai.controller.ts` 第 227-236 行先 `throw BadRequestException`，之后的 `processBufferedFiles` 永远不会执行，但文件已被完整读入内存。

**Files:**
- 修改: `apps/server/src/ee/ai/ai.controller.ts:227-236`

- [ ] **Step 1: 删除 dead code**

当前代码（第 227-236 行）：
```typescript
if (bufferedFiles.length > 0) {
  throw new BadRequestException(
    'File attachments must use the MinerU-backed agent document task flow.',
  );
}

const history = parseCreatorHistory(historyRaw);

// Process uploaded files (already buffered)
const contentParts = await this.aiFileService.processBufferedFiles(bufferedFiles);
```

修改后（移除 dead code）：
```typescript
if (bufferedFiles.length > 0) {
  throw new BadRequestException(
    'File attachments must use the MinerU-backed agent document task flow.',
  );
}

const history = parseCreatorHistory(historyRaw);
// bufferedFiles.length === 0 guaranteed here; no file processing needed.
```

删除第 235-236 行（`const contentParts = ...`），并找到所有引用 `contentParts` 的地方确认是否还需要（若下方代码不再使用则一并移除）。

- [ ] **Step 2: 确认编译通过**

```bash
cd apps/server
pnpm build 2>&1 | grep -E "error TS"
# 预期：无错误
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/ai.controller.ts
git commit -m "fix: remove dead code after file upload BadRequestException in creator/generate"
```

---

## Task 5: 实现 InlineRewriteService 真实 AI 调用

**背景：** `InlineRewriteService.rewriteSelection` 当前直接返回输入内容，无任何 AI 调用。需注入 `AiService`，构建改写 prompt 并调用 `generateText`。

**Files:**
- 修改: `apps/server/src/ee/ai/inline/inline-rewrite.service.ts`
- 新增: `apps/server/src/ee/ai/inline/inline-rewrite.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/ee/ai/inline/inline-rewrite.service.spec.ts
import { InlineRewriteService } from './inline-rewrite.service';
import { AiService } from '../services/ai.service';

describe('InlineRewriteService', () => {
  const mockAiService = {
    generate: jest.fn(),
  } as unknown as AiService;

  const service = new InlineRewriteService(mockAiService);

  beforeEach(() => jest.clearAllMocks());

  it('calls AiService.generate with selection and action', async () => {
    (mockAiService.generate as jest.Mock).mockResolvedValue({
      content: 'Improved text',
      usage: { totalTokens: 100 },
    });

    const result = await service.rewriteSelection({
      selectionSnapshot: 'Original text.',
      localContext: 'Before. Original text. After.',
      action: 'improve_writing',
      taskSummaryRef: null,
    });

    expect(mockAiService.generate).toHaveBeenCalledTimes(1);
    const callArg = (mockAiService.generate as jest.Mock).mock.calls[0][0];
    expect(callArg.content).toContain('Original text.');
    expect(callArg.action).toBe('improve_writing');
    expect(result.candidate).toBe('Improved text');
    expect(result.riskFlags).toEqual([]);
    expect(result.allowedActions).toContain('replace_selection');
  });

  it('falls back to content when AI returns empty string', async () => {
    (mockAiService.generate as jest.Mock).mockResolvedValue({ content: '' });

    const result = await service.rewriteSelection({
      selectionSnapshot: 'Original',
      localContext: 'Original',
      action: 'improve_writing',
      taskSummaryRef: null,
    });

    expect(result.candidate).toBe('Original');
  });

  it('falls back to content when AiService throws', async () => {
    (mockAiService.generate as jest.Mock).mockRejectedValue(new Error('AI unavailable'));

    const result = await service.rewriteSelection({
      selectionSnapshot: 'Original',
      localContext: 'Original',
      action: 'custom',
      taskSummaryRef: null,
    });

    // 降级返回原文，不抛出
    expect(result.candidate).toBe('Original');
    expect(result.riskFlags).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd apps/server
pnpm test src/ee/ai/inline/inline-rewrite.service.spec.ts
# 预期：FAIL — cannot read property 'generate' of undefined（service 未注入 AiService）
```

- [ ] **Step 3: 实现 InlineRewriteService**

```typescript
// apps/server/src/ee/ai/inline/inline-rewrite.service.ts — 完整替换
import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../services/ai.service';
import { AiAction } from '../dto/ai.dto';

export interface InlineRewriteRequest {
  selectionSnapshot: string;
  localContext: string;
  action: string;
  taskSummaryRef?: {
    summary?: string;
    includeRawHistory?: boolean;
  } | null;
}

@Injectable()
export class InlineRewriteService {
  private readonly logger = new Logger(InlineRewriteService.name);

  constructor(private readonly aiService: AiService) {}

  async rewriteSelection(request: InlineRewriteRequest) {
    const { selectionSnapshot, localContext, action } = request;

    try {
      // 使用 localContext 作为主内容（包含前后文语境），selection 作为焦点提示
      const content = localContext || selectionSnapshot;
      const prompt = selectionSnapshot !== localContext
        ? `Focus your changes only on this specific selection: "${selectionSnapshot}"`
        : undefined;

      const result = await this.aiService.generate({
        action: action as AiAction,
        content,
        prompt,
      });

      const candidate = result.content?.trim() || selectionSnapshot;

      return {
        candidate,
        riskFlags: [],
        allowedActions: ['replace_selection', 'insert_below'],
      };
    } catch (err: any) {
      this.logger.warn(`InlineRewriteService fallback: ${err?.message}`);
      return {
        candidate: selectionSnapshot || localContext,
        riskFlags: [],
        allowedActions: ['replace_selection', 'insert_below'],
      };
    }
  }
}
```

- [ ] **Step 4: 更新 AiModule，注入 AiService 到 InlineRewriteService**

打开 `apps/server/src/ee/ai/ai.module.ts`，确认 `InlineRewriteService` 已在 providers 中，且 `AiService` 也在 providers 中（两者同 module）。不需要额外改动，因为同 module 内的 provider 会自动注入。

验证：
```bash
grep -n "InlineRewriteService\|AiService" apps/server/src/ee/ai/ai.module.ts
```

若 `InlineRewriteService` 未在 providers 中，添加之。

- [ ] **Step 5: 运行所有 inline 测试**

```bash
cd apps/server
pnpm test src/ee/ai/inline/ --passWithNoTests
# 预期：3 passed（service spec 3 个测试）
# controller spec 仍用 mock，不受影响
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ee/ai/inline/inline-rewrite.service.ts
git add apps/server/src/ee/ai/inline/inline-rewrite.service.spec.ts
git commit -m "feat: implement InlineRewriteService with real AiService.generate call"
```

---

## Task 6: 在 AiCreatorPanel 挂载 AiCreatorMessages

**背景：** `AiCreatorMessages` 组件已完整实现（包含欢迎页、消息气泡、流式指示器），但未在 `AiCreatorPanel` 中渲染，导致面板打开后看不到任何消息历史。

**Files:**
- 修改: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx:1,226-299`

- [ ] **Step 1: 添加 import**

在 `ai-creator-panel.tsx` 顶部 import 区域（约第 22 行，现有 `AiCreatorSelection` import 之后）添加：

```typescript
import { AiCreatorMessages } from "./ai-creator-messages";
```

- [ ] **Step 2: 在 panelBody 内挂载 AiCreatorMessages**

将第 226-299 行的 `panelBody` 区域从：

```jsx
<div className={classes.panelBody}>
  <DocumentOperationCenter
    status={session.status}
    ...
  />
</div>
```

改为：

```jsx
<div className={classes.panelBody}>
  <AiCreatorMessages
    messages={session.messages}
    isStreaming={session.isStreaming}
    agentSteps={session.steps}
    onResume={session.resume}
  />
  <DocumentOperationCenter
    status={session.status}
    sourceScope={session.documentTask.sourceScope}
    mode={formatDocumentTaskMode(session.documentTask.mode)}
    deepCollaborationEnabled={session.documentTask.deepCollaborationEnabled}
    onToggleDeepCollaboration={session.toggleDeepCollaboration}
    taskSummary={
      session.documentTask.taskSummary.summary ||
      currentBrief?.goal ||
      t("No active document task yet.")
    }
    steps={session.steps}
    brief={session.awaitInput?.phase === "brief" ? currentBrief : null}
    assetSummary={session.awaitInput?.phase === "brief" ? currentAssetSummary : undefined}
    onConfirmBrief={(brief) => {
      session.resume({
        type: "confirm_brief",
        brief: brief as unknown as Record<string, unknown>,
      });
    }}
    onOpenBlueprint={
      session.awaitInput?.phase === "blueprint" && currentBlueprint
        ? () => setBlueprintOpened(true)
        : undefined
    }
    onOpenReview={
      session.awaitInput?.phase === "review" && currentReviewReport
        ? () => setReviewOpened(true)
        : undefined
    }
    plan={
      currentBlueprint
        ? {
            title: currentBlueprint.title,
            sections: currentBlueprint.sections.map((section) => section.title),
          }
        : session.documentTask.plan
    }
    diffSet={session.documentTask.diffSet as Array<{
      diffId: string;
      label: string;
      granularity: string;
    }>}
    pendingChangeCount={session.documentTask.pendingChangeSet.length}
    canApply={session.applyRollback.canApply}
    canRollback={session.applyRollback.canRollback}
    onApplyPendingChanges={session.applyAcceptedChanges}
    onRollbackSnapshot={session.rollbackAcceptedChanges}
    onConfirmExpertCollab={
      session.expertCollab.status === "awaiting_decision"
        ? handleExpertCollabConfirm
        : undefined
    }
    onReviseExpertCollab={
      session.expertCollab.status === "awaiting_decision"
        ? handleExpertCollabRevise
        : undefined
    }
    expertCollab={
      session.expertCollab.status === "awaiting_decision"
        ? {
            reason: session.expertCollab.reason,
            question: session.expertCollab.question,
            options: session.expertCollab.options as Array<{
              id?: string;
              label?: string;
            }>,
            recommendedOption: session.expertCollab.recommendedOption,
          }
        : null
    }
  />
</div>
```

- [ ] **Step 3: 检查 `session.messages` 是否由 `useAiCreateSession` 暴露**

```bash
grep -n "messages" apps/client/src/ee/ai/hooks/use-ai-create-session.ts | head -20
```

确认 `session` 对象上存在 `messages`、`isStreaming`、`steps`、`resume` 字段。若字段名不同，按实际名称调整。

- [ ] **Step 4: 本地启动验证**

```bash
pnpm dev
```

本地验证步骤：
1. 在浏览器打开任意文档页面
2. 点击页面顶部工具栏的 `✨` AI 助手按钮（在 `page-header-menu.tsx` 中已存在）打开侧边面板
3. 在输入框中发送一条测试消息（如 `"帮我写一段介绍"`）
4. 确认消息气泡出现在面板上方的消息列表区域（而非消息历史空白）
5. 确认 AI 回复流式输出显示在消息列表中

- [ ] **Step 5: TypeScript 编译检查**

```bash
cd apps/client
pnpm tsc --noEmit 2>&1 | grep -E "ai-creator-panel"
# 预期：无错误
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx
git commit -m "fix: mount AiCreatorMessages in AiCreatorPanel to restore message history display"
```

---

## 验收检查

所有 Task 完成后执行：

```bash
# NestJS 单元测试
cd apps/server
pnpm test src/ee/ai/inline/ src/ee/ai/dto/ --passWithNoTests

# Python 单元测试
cd agent-service
pytest tests/test_auth_middleware.py tests/orchestrator/test_document_task_engine_conflicts.py -v

# TypeScript 编译
cd apps/client && pnpm tsc --noEmit
cd apps/server && pnpm build 2>&1 | grep "error TS"
```

预期：0 failures，0 TypeScript errors。
