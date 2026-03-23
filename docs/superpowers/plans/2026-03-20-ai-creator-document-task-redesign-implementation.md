# AI Creator文档-任务重新设计实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 将当前聊天优先的 AI Creator 工作台替换为文档任务优先的架构，该架构将内联重写、文档操作中心和专家协作分开，同时保留上传/当前文档结构。

**架构：** 分四个部分进行重新设计：合约优先的 API shell、客户端状态和 UI 切换、严格保留的文档任务引擎，然后审查/应用/回滚和迁移清理。重用现有的 MinerU-first 和源感知解析投资，但将节写入降级为仅综合流程；文档优化变为 `diffSet -> pendingChangeSet -> apply/rollback` 而不是合并 Markdown 生成。

**技术栈：** React 18、Mantine、Jotai、TypeScript、tsx 测试、NestJS、Jest、FastAPI、Pydantic、pytest、Tiptap/Yjs、SSE

**工作树：** 从 `E:\test\Docmost` 执行此计划。保留现有的源代码编写更改；该计划重新定位它们而不是取代它们。

---

## 范围和顺序注释

- 这仍然是一个协调的计划，因为产品切换、API 合约和引擎路由都以相同的新抽象为中心：`DocumentTask`。
- 第一个出货里程碑不是“新代理力量”。这是“正确的产品边界”。
- 严格保存文档优化必须停止默认为`brief -> blueprint -> section writer -> merge`。
- 上传的文档优化应保留`MinerU-first / Docling fallback`。
- 当前页面优化应首先使用编辑器/页面结构，然后提供相同的文档任务引擎。
- 空白页起草仍然受支持，但移至优先级较低的合成路径后面。

## 成功标准

- 选择重写默认情况下内联运行，不会污染文档任务状态。
- 上传的文件在存在时保留默认的主要来源，并且当前页面内容仅在明确请求时加入。
- 右侧面板默认为文档操作中心，而非聊天记录。
- 文档转换任务生成类型化的 `diffSet` 和 `pendingChangeSet` 结果，而不仅仅是合并的 Markdown。
- 最终应用创建回滚快照并在失败时保留原始文档。
- 深度协作可以自动推荐，但也可以根据任务关闭。
- 对图像、表格、代码块和Mermaid 块执行严格的保存规则。
- 章节编写不再是文档优化的默认路径；它仅用于综合和大范围的起草。

## 文件结构概述

### 新文件

- `apps/client/src/ee/ai/types/document-task.types.ts`
- `apps/client/src/ee/ai/services/document-task-service.ts`
- `apps/client/src/ee/ai/services/inline-rewrite-service.ts`
- `apps/client/src/ee/ai/hooks/use-document-task.ts`
- `apps/client/src/ee/ai/hooks/use-inline-rewrite.ts`
- `apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts`
- `apps/client/src/ee/ai/hooks/use-expert-collab.ts`
- `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx`
- `apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- `apps/client/src/ee/ai/hooks/use-document-task.test.tsx`
- `apps/server/src/ee/ai/document-tasks/document-task.types.ts`
- `apps/server/src/ee/ai/document-tasks/document-tasks.controller.ts`
- `apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- `apps/server/src/ee/ai/document-tasks/document-tasks.controller.spec.ts`
- `apps/server/src/ee/ai/document-tasks/document-tasks.service.spec.ts`
- `apps/server/src/ee/ai/inline/inline-rewrite.controller.ts`
- `apps/server/src/ee/ai/inline/inline-rewrite.service.ts`
- `apps/server/src/ee/ai/inline/inline-rewrite.controller.spec.ts`
- `agent-service/app/models/document_task.py`
- `agent-service/app/workers/page_asset_parser.py`
- `agent-service/app/orchestrator/document_task_engine.py`
- `agent-service/app/orchestrator/tools/build_diff_set.py`
- `agent-service/tests/workers/test_page_asset_parser.py`
- `agent-service/tests/orchestrator/test_document_task_engine.py`
- `agent-service/tests/orchestrator/test_build_diff_set.py`

### 修改文件

- `apps/client/src/ee/ai/services/ai-intent.ts`
- `apps/client/src/ee/ai/services/ai-intent.test.ts`
- `apps/client/src/ee/ai/services/agent-service.ts`
- `apps/client/src/ee/ai/services/ai-create-runner.ts`
- `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- `apps/client/src/ee/ai/hooks/ai-create-session.commit.ts`
- `apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-session.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`
- `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx`
- `apps/client/src/ee/ai/components/editor/ai-menu/result-preview.tsx`
- `apps/server/src/ee/ai/ai.module.ts`
- `apps/server/src/ee/ai/ai.controller.ts`
- `apps/server/src/ee/ai/creator-commit.utils.ts`
- `apps/server/src/ee/ai/creator-commit.utils.spec.ts`
- `apps/server/src/ee/ai/creator-commit.runtime.test.ts`
- `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- `apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts`
- `apps/server/src/ee/ai/document-plan.ts`
- `apps/server/src/ee/ai/document-plan.spec.ts`
- `apps/server/src/ee/ai/document-strategy.ts`
- `apps/server/src/ee/ai/document-strategy.spec.ts`
- `agent-service/app/main.py`
- `agent-service/app/schemas/request.py`
- `agent-service/app/schemas/response.py`
- `agent-service/app/schemas/document_contracts.py`
- `agent-service/app/models/state.py`
- `agent-service/app/orchestrator/engine.py`
- `agent-service/app/orchestrator/tools/complexity.py`
- `agent-service/app/orchestrator/tools/evidence.py`
- `agent-service/app/orchestrator/tools/parse_assets.py`
- `agent-service/app/orchestrator/tools/simple_edit.py`
- `agent-service/app/orchestrator/tools/finalize.py`
- `agent-service/app/orchestrator/tools/write_tools.py`
- `agent-service/app/orchestrator/tools/create_brief.py`
- `agent-service/app/orchestrator/tools/create_blueprint.py`
- `agent-service/app/orchestrator/tools/user_interaction.py`
- `agent-service/app/workers/asset_parser.py`
- `agent-service/app/workers/section_writer.py`
- `agent-service/tests/test_main.py`
- `agent-service/tests/test_protocol_schemas.py`
- `agent-service/tests/orchestrator/test_engine.py`
- `agent-service/tests/orchestrator/test_complexity.py`
- `agent-service/tests/orchestrator/test_parse_assets.py`
- `agent-service/tests/orchestrator/test_parse_assets_mineru.py`
- `agent-service/tests/orchestrator/test_simple_edit.py`
- `agent-service/tests/orchestrator/test_write_tools.py`
- `agent-service/tests/orchestrator/test_finalize.py`
- `agent-service/tests/orchestrator/test_e2e_level3.py`
- `agent-service/tests/workers/test_asset_parser.py`
- `agent-service/tests/workers/test_section_writer.py`
- `agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

---

## 分块 1：共享合约与 API 壳层

### 任务 1：引入 `DocumentTask` 合约与意图映射，但不改变运行时行为

**文件：**
- 创建：`apps/client/src/ee/ai/types/document-task.types.ts`
- 创建：`apps/server/src/ee/ai/document-tasks/document-task.types.ts`
- 创建：`agent-service/app/models/document_task.py`
- 修改：`apps/client/src/ee/ai/services/ai-intent.ts`
- 修改：`apps/client/src/ee/ai/services/ai-intent.test.ts`
- 修改：`apps/server/src/ee/ai/document-plan.ts`
- 修改：`apps/server/src/ee/ai/document-plan.spec.ts`
- 修改：`apps/server/src/ee/ai/document-strategy.ts`
- 修改：`apps/server/src/ee/ai/document-strategy.spec.ts`
- 修改：`agent-service/app/schemas/document_contracts.py`
- 修改：`agent-service/app/schemas/request.py`
- 修改：`agent-service/app/schemas/response.py`
- 测试： `agent-service/tests/test_protocol_schemas.py`

- [ ] **第 1 步：编写失败的合约测试**

添加案例：
- `document_transform` 默认严格保存
- 上传的文件在存在时默认成为主要来源
- 当前页面内容加入上传源仅根据明确请求进行转换
- 宽松的优化仍然是受约束的文档转换模式，而不是不受限制的重新起草
- 结构化摘要继承而不是原始消息历史记录继承
- 混合粒度差异元数据
- 明确的`apply`和`rollback`有效负载形状

- [ ] **第 2 步：运行合约测试以验证失败**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/document-plan.spec.ts src/ee/ai/document-strategy.spec.ts`
- `python -m pytest agent-service/tests/test_protocol_schemas.py -q`

预计：
- 客户端测试失败，因为 `ai-intent.ts` 只返回路由/范围/策略，而不返回文档任务模式元数据
- 架构测试失败，因为代理协议尚未公开 `DocumentTask` 字段

- [ ] **第 3 步：实施类型化任务契约**

在三层中添加一个共享的概念形状：

```ts
type DocumentTaskMode = 'strict_preservation' | 'relaxed_optimization';
type DocumentTaskStatus =
  | 'idle'
  | 'analyzing'
  | 'awaiting_plan_confirmation'
  | 'generating_diff'
  | 'awaiting_review'
  | 'ready_to_apply'
  | 'applied'
  | 'error';
```

在 `document_contracts.py` 和 `document_task.py` 中反映相同的概念，同时保留接受旧请求字段以实现兼容性。

同时规范 `ai-intent.ts` 和 `document-strategy.ts` 中的源范围规则，以便合约明确支持：
- `uploaded_document`
- `current_page`
- `uploaded_plus_current_page`

并包括用于保留含义和图像文本对应的宽松模式护栏。

- [ ] **第 4 步：重新运行测试以验证合约层是否通过**

运行步骤 2 中的相同命令。

预计：
- 通过新类型，但行为尚未改变

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/types/document-task.types.ts apps/client/src/ee/ai/services/ai-intent.ts apps/client/src/ee/ai/services/ai-intent.test.ts apps/server/src/ee/ai/document-tasks/document-task.types.ts apps/server/src/ee/ai/document-plan.ts apps/server/src/ee/ai/document-plan.spec.ts apps/server/src/ee/ai/document-strategy.ts apps/server/src/ee/ai/document-strategy.spec.ts agent-service/app/models/document_task.py agent-service/app/schemas/document_contracts.py agent-service/app/schemas/request.py agent-service/app/schemas/response.py agent-service/tests/test_protocol_schemas.py
git commit -m "feat(ai): add shared document-task contracts"
```

### 任务 2：在保留旧端点的同时添加 Nest 与客户端文档任务 API 壳层

**文件：**
- 创建：`apps/client/src/ee/ai/services/document-task-service.ts`
- 创建：`apps/server/src/ee/ai/document-tasks/document-tasks.controller.ts`
- 创建：`apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- 创建：`apps/server/src/ee/ai/document-tasks/document-tasks.controller.spec.ts`
- 创建：`apps/server/src/ee/ai/document-tasks/document-tasks.service.spec.ts`
- 修改：`apps/server/src/ee/ai/ai.module.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts`
- 修改：`apps/client/src/ee/ai/services/agent-service.ts`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.ts`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **第 1 步：编写失败的端点和客户端测试**

添加覆盖范围：
- `POST /ai/document-tasks`
- `POST /ai/document-tasks/:taskId/plan`
- `POST /ai/document-tasks/:taskId/diff`
- `POST /ai/document-tasks/:taskId/review`
- `POST /ai/document-tasks/:taskId/apply`
- `POST /ai/document-tasks/:taskId/rollback`
- `POST /ai/document-tasks/:taskId/collab`

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/document-tasks/document-tasks.controller.spec.ts src/ee/ai/document-tasks/document-tasks.service.spec.ts src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`

预计：
- 失败，因为文档任务控制器/服务和客户端服务不存在

- [ ] **步骤 3：使用兼容性适配器实现 API shell**

第一个版本可以代理现有的网关/协调器行为，但新的公共形状必须已经以任务为中心：
- `createTask()`
- `requestPlan()`
- `requestDiff()`
- `submitReview()`
- `applyAcceptedChanges()`
- `rollbackAppliedChanges()`
- `resolveCollabDecision()`

- [ ] **步骤 4：重新运行测试以验证 shell 通过**

运行步骤 2 中的相同命令。

预计：
- PASS，旧的 `/ai/creator/generate` 和 `/agent/run` 仍然保持兼容性

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/services/document-task-service.ts apps/client/src/ee/ai/services/agent-service.ts apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/server/src/ee/ai/ai.module.ts apps/server/src/ee/ai/document-tasks/document-tasks.controller.ts apps/server/src/ee/ai/document-tasks/document-tasks.service.ts apps/server/src/ee/ai/document-tasks/document-tasks.controller.spec.ts apps/server/src/ee/ai/document-tasks/document-tasks.service.spec.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts
git commit -m "feat(ai): add document-task api shell"
```

### 任务 2A：添加专用的内联重写 API 并将其与文档任务端点分开

**文件：**
- 创建：`apps/client/src/ee/ai/services/inline-rewrite-service.ts`
- 创建：`apps/server/src/ee/ai/inline/inline-rewrite.controller.ts`
- 创建：`apps/server/src/ee/ai/inline/inline-rewrite.service.ts`
- 创建：`apps/server/src/ee/ai/inline/inline-rewrite.controller.spec.ts`
- 修改：`apps/server/src/ee/ai/ai.module.ts`
- 修改：`apps/client/src/ee/ai/hooks/use-inline-rewrite.ts`
- 修改：`apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.ts`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- 修改：`agent-service/app/orchestrator/tools/simple_edit.py`
- 修改：`agent-service/tests/orchestrator/test_simple_edit.py`

- [ ] **第 1 步：编写失败的内联 API 测试**

添加覆盖范围：
- `POST /ai/inline/rewrite`
- 请求有效负载包含 `selectionSnapshot`、`localContext`、`action` 和可选的 `taskSummaryRef`
- 包含 `candidate`、`riskFlags` 和允许的插入/替换选项的响应负载

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/inline/inline-rewrite.controller.spec.ts`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `python -m pytest agent-service/tests/orchestrator/test_simple_edit.py -q`

预计：
- 失败，因为内联重写仍然依赖遗留创建者/会话管道而不是专用合约

- [ ] **第 3 步：实施专用内联合约**

Rules:
- 内联重写仍然是与 `DocumentTask` 分开的 API 表面
- 它使用内联重写引擎路径，而不是文档任务审查/应用端点
- 它可以读取结构化任务摘要参考，但绝不会读取原始文档任务历史记录

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过专用内联合约

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/services/inline-rewrite-service.ts apps/server/src/ee/ai/inline/inline-rewrite.controller.ts apps/server/src/ee/ai/inline/inline-rewrite.service.ts apps/server/src/ee/ai/inline/inline-rewrite.controller.spec.ts apps/server/src/ee/ai/ai.module.ts apps/client/src/ee/ai/hooks/use-inline-rewrite.ts apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts agent-service/app/orchestrator/tools/simple_edit.py agent-service/tests/orchestrator/test_simple_edit.py
git commit -m "feat(ai): add dedicated inline rewrite api"
```

## 分块 2：客户端状态与 UI 切换

### 任务 3：将 `use-ai-create-session` 拆分为聚焦的任务 Hooks

**文件：**
- 创建：`apps/client/src/ee/ai/hooks/use-document-task.ts`
- 创建：`apps/client/src/ee/ai/hooks/use-inline-rewrite.ts`
- 创建：`apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts`
- 创建：`apps/client/src/ee/ai/hooks/use-expert-collab.ts`
- 创建：`apps/client/src/ee/ai/hooks/use-document-task.test.tsx`
- 修改：`apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`

- [ ] **第 1 步：编写失败的钩子和reducer测试**

添加测试证明：
- 文档任务摘要继承不包括原始消息历史记录
- 内联重写状态独立于文档任务状态
- 专家协作状态存储结构化决策，而不是通用消息

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/hooks/use-document-task.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`

预计：
- 失败，因为当前的reducer仍然采用会话/消息优先模型

- [ ] **第 3 步：实施聚焦挂钩并保留 `use-ai-create-session` 作为临时适配器**

Rules:
- `use-document-task` 拥有 `taskSummary`、`plan`、`diffSet`、`pendingChangeSet` 和任务状态
- `use-inline-rewrite`仅拥有选择快照和预览结果
- `use-expert-collab` 仅拥有待决问题和已确认的决定
- `use-ai-create-session` 可能会暂时保留，但它应该委托而不是拥有新状态本身

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过新的状态拆分和兼容性适配器仍在编译

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/hooks/use-document-task.ts apps/client/src/ee/ai/hooks/use-inline-rewrite.ts apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts apps/client/src/ee/ai/hooks/use-expert-collab.ts apps/client/src/ee/ai/hooks/use-document-task.test.tsx apps/client/src/ee/ai/hooks/use-ai-create-session.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
git commit -m "refactor(client): split ai creator state by task type"
```

### 任务 4：用文档操作中心壳层替换右侧工作台

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-session.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`

- [ ] **第 1 步：编写失败的 UI 测试**

添加测试证明：
- 面板默认为任务标题+模式/源代码控制+差异审查+挂起的更改栏
- `DocumentTreePanel`、实时草稿和通用消息历史记录不再是面板的默认中心
- 面板可以呈现计划确认状态，而无需假装它是聊天线程
- 面板清晰地显示结构化任务摘要和明确的应用/回滚控制

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`

预计：
- 失败，因为当前面板仍然呈现工作台/会话 shell

- [ ] **第 3 步：实施面板割接**

默认视觉顺序：
1.任务标题
2.源范围+模式控制
3. 规划或比较工作空间
4.待更改栏

不要将消息记录呈现为主要布局。
使结构化任务摘要、计划预览和应用/回滚可供性可见，而无需进行专家协作。

- [ ] **第 4 步：重新运行测试和类型检查**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`

预计：
- 新外壳就位后通过

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-session.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx
git commit -m "feat(client): cut over ai creator to document operation center"
```

### 任务 5：保持选区改写内联，并与文档任务隔离

**文件：**
- 修改：`apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx`
- 修改：`apps/client/src/ee/ai/components/editor/ai-menu/result-preview.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.test.ts`
- 修改：`apps/server/src/ee/ai/creator-commit.utils.ts`
- 修改：`apps/server/src/ee/ai/creator-commit.utils.spec.ts`
- 修改：`apps/server/src/ee/ai/creator-commit.runtime.test.ts`
- 修改：`agent-service/app/orchestrator/tools/simple_edit.py`
- 修改：`agent-service/tests/orchestrator/test_simple_edit.py`

- [ ] **第 1 步：编写用于选择隔离的失败测试**

添加案例证明：
- 选择重写读取 `selectionSnapshot + localContext + structuredTaskSummaryRef`
- 选择重写不继承原始消息历史记录
- 过时的选择替换安全失败，而不是默默降级以追加默认内联重写

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/creator-commit.utils.spec.ts src/ee/ai/creator-commit.runtime.test.ts`
- `python -m pytest agent-service/tests/orchestrator/test_simple_edit.py -q`

预计：
- 失败，因为当前写回路径允许选择漂移并且内联流仍然共享太多会话状态

- [ ] **第 3 步：实施隔离规则**

Rules:
- 默认内联重写是一个短暂的任务
- 它可能只读取结构化任务摘要
- 它不得改变活动文档任务差异集
- 过时的选择写入应该显示可恢复的冲突，而不是静默追加

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过选择重写隔离和更安全的写回语义

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx apps/client/src/ee/ai/components/editor/ai-menu/result-preview.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.test.ts apps/server/src/ee/ai/creator-commit.utils.ts apps/server/src/ee/ai/creator-commit.utils.spec.ts apps/server/src/ee/ai/creator-commit.runtime.test.ts agent-service/app/orchestrator/tools/simple_edit.py agent-service/tests/orchestrator/test_simple_edit.py
git commit -m "fix(ai): isolate inline rewrite from document tasks"
```

## 分块 3：文档任务引擎与保留式解析

### 任务 6：引入 `DocumentTaskEngine`，按工作流而非聊天/会话路由任务

**文件：**
- 创建：`agent-service/app/orchestrator/document_task_engine.py`
- 创建：`agent-service/tests/orchestrator/test_document_task_engine.py`
- 修改：`agent-service/app/main.py`
- 修改：`agent-service/app/models/state.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/orchestrator/tools/complexity.py`
- 修改：`agent-service/app/orchestrator/tools/evidence.py`
- 修改：`agent-service/tests/test_main.py`
- 修改：`agent-service/tests/orchestrator/test_engine.py`
- 修改：`agent-service/tests/orchestrator/test_complexity.py`

- [ ] **第 1 步：编写失败的引擎路由测试**

添加案例证明：
- 选择重写使用 `Inline Rewrite` 行为
- 严格模式下的文档转换使用 `Preservation Patch Flow`
- 空白页起草和宽松的大范围重写使用`Draft/Synthesis Flow`
- 专家协作是一个子状态，而不是第三个独立引擎

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `python -m pytest agent-service/tests/orchestrator/test_document_task_engine.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_complexity.py agent-service/tests/test_main.py -q`

预计：
- 失败，因为当前路由仍然以 1/2/3 级协调器路径为中心

- [ ] **第 3 步：实施引擎拆分**

保持兼容性：
- 现有的`OrchestratorEngine`可能仍然作为较低级别的助手
- `DocumentTaskEngine` 成为公共决策点
- 选择重写、保存补丁和合成应该是显式分支

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过任务优先路由

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/document_task_engine.py agent-service/tests/orchestrator/test_document_task_engine.py agent-service/app/main.py agent-service/app/models/state.py agent-service/app/orchestrator/engine.py agent-service/app/orchestrator/tools/complexity.py agent-service/app/orchestrator/tools/evidence.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_complexity.py
git commit -m "refactor(agent-service): route ai work through document task engine"
```

### 任务 6A：使空白页起草和多文档合成明确的工作流程分支

**文件：**
- 修改：`agent-service/app/orchestrator/document_task_engine.py`
- 修改：`agent-service/app/orchestrator/tools/create_brief.py`
- 修改：`agent-service/app/orchestrator/tools/create_blueprint.py`
- 修改：`agent-service/app/orchestrator/tools/user_interaction.py`
- 修改：`apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx`
- 修改：`agent-service/tests/orchestrator/test_e2e_level3.py`
- 修改：`agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

- [ ] **第 1 步：编写失败的起草和综合测试**

添加案例证明：
- 小空白页起草请求可以直接起草，无需不必要的计划
- 大型空白页起草请求需要首先确认简短或大纲
- 当来源不一致时，多文档合成进入明确的冲突解决/协作

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `python -m pytest agent-service/tests/orchestrator/test_e2e_level3.py -q`
- `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

预计：
- 失败，因为空白页起草和多文档合成尚未分解为显式受保护的工作流程

- [ ] **第 3 步：实现显式综合分支**

Rules:
- 小空白页任务可以直接起草
- 大型空白页任务必须通过简短/大纲确认来控制
- 多文档合成必须将结构化冲突转化为协作，而不是默默地合并矛盾的材料

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过明确的起草/综合工作流程边界

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/document_task_engine.py agent-service/app/orchestrator/tools/create_brief.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/orchestrator/tools/user_interaction.py apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/browser_ai_creator_agent_outline_e2e.py
git commit -m "feat(ai): make drafting and synthesis workflows explicit"
```

### 任务 7：添加当前页面素材解析，并在同一补丁流中保留上传/当前页证据

**文件：**
- 创建：`agent-service/app/workers/page_asset_parser.py`
- 创建：`agent-service/tests/workers/test_page_asset_parser.py`
- 修改：`agent-service/app/workers/asset_parser.py`
- 修改：`agent-service/app/orchestrator/tools/parse_assets.py`
- 修改：`agent-service/app/orchestrator/tools/evidence.py`
- 修改：`agent-service/app/orchestrator/tools/finalize.py`
- 修改：`agent-service/tests/workers/test_asset_parser.py`
- 修改：`agent-service/tests/workers/test_page_asset_parser.py`
- 修改：`agent-service/tests/orchestrator/test_parse_assets.py`
- 修改：`agent-service/tests/orchestrator/test_parse_assets_mineru.py`
- 修改：`apps/server/src/ee/ai/evidence-preflight.ts`
- 修改：`apps/server/src/ee/ai/evidence-preflight.spec.ts`

- [ ] **第 1 步：编写失败的解析测试**

添加案例证明：
- 当前页面优化产生图像、表格和代码块的资产感知块
- 上传文件优化保持 MinerU 优先/Docling 后备
- 严格模式保留原始图像放置元数据并跳过不安全的表/代码转换而不是展平它们

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `python -m pytest agent-service/tests/workers/test_asset_parser.py agent-service/tests/workers/test_page_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts`

预计：
- 失败，因为当前页面证据仍然主要是原始Markdown/上下文，而不是资产感知结构

- [ ] **第三步：实现统一保存解析**

Rules:
- 上传的文件：`MinerU-first -> Docling fallback`
- 当前页面：编辑器/页面结构优先
- 两个输出均归一化为一个资产感知块图
- 严格模式在不确定时保持图像位置固定
- 严格模式使不安全的表/代码/Mermaid 块保持不变

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过一份具有保存意识的证据合同

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/page_asset_parser.py agent-service/tests/workers/test_page_asset_parser.py agent-service/app/workers/asset_parser.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/orchestrator/tools/evidence.py agent-service/app/orchestrator/tools/finalize.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_mineru.py apps/server/src/ee/ai/evidence-preflight.ts apps/server/src/ee/ai/evidence-preflight.spec.ts
git commit -m "feat(agent-service): unify uploaded and page evidence for preservation patch flow"
```

## 分块 4：Diff 审查、应用/回滚与迁移清理

### 任务 8：生成 `diffSet` 与 `pendingChangeSet`，替代 merged-markdown-first 输出

**文件：**
- 创建：`agent-service/app/orchestrator/tools/build_diff_set.py`
- 创建：`agent-service/tests/orchestrator/test_build_diff_set.py`
- 修改：`agent-service/app/orchestrator/tools/finalize.py`
- 修改：`agent-service/app/orchestrator/tools/write_tools.py`
- 修改：`agent-service/app/workers/section_writer.py`
- 修改：`agent-service/tests/orchestrator/test_write_tools.py`
- 修改：`agent-service/tests/orchestrator/test_finalize.py`
- 修改：`agent-service/tests/workers/test_section_writer.py`
- 修改：`apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- 修改：`apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx`

- [ ] **第 1 步：编写失败的差异生成测试**

添加案例证明：
- 严格保留文档转换产生块级差异条目
- 文本块可以显示更精细的文本差异
- 宽松的优化可能会重新排序结构，但必须保留含义和图像文本对应关系
- 节编写器不再是文档转换的默认路径
- 部分编写器仍然可用于仅综合任务

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `python -m pytest agent-service/tests/orchestrator/test_build_diff_set.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_finalize.py agent-service/tests/workers/test_section_writer.py -q`
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`

预计：
- 失败，因为当前的完成/写入流程仍然倾向于合并后的 Markdown

- [ ] **步骤 3：实现 diff-first 输出**

Rules:
- 文档转换返回 `diffSet`、`assetImpact`、`riskFlags`
- 接受的物品累积在`pendingChangeSet`中
- 宽松的优化可能会改变结构，但必须保持意义和图文对应完整
- 章节写作仅停留在综合流程之后

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过 diff-first 文档优化

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/build_diff_set.py agent-service/tests/orchestrator/test_build_diff_set.py agent-service/app/orchestrator/tools/finalize.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/workers/section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_finalize.py agent-service/tests/workers/test_section_writer.py apps/server/src/ee/ai/document-tasks/document-tasks.service.ts apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx
git commit -m "feat(ai): make document transform diff-first"
```

### 任务 9：将 apply/rollback 接入现有安全提交路径，并暴露专家协作

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- 修改：`apps/client/src/ee/ai/hooks/use-expert-collab.ts`
- 修改：`apps/client/src/ee/ai/hooks/ai-create-session.commit.ts`
- 修改：`apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts`
- 修改：`apps/server/src/ee/ai/creator-commit.utils.ts`
- 修改：`apps/server/src/ee/ai/creator-commit.utils.spec.ts`
- 修改：`apps/server/src/ee/ai/creator-commit.runtime.test.ts`
- 修改：`apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- 修改：`apps/server/src/ee/ai/ai.controller.ts`
- 修改：`agent-service/app/schemas/response.py`
- 修改：`agent-service/tests/test_protocol_schemas.py`

- [ ] **第 1 步：编写失败的应用/回滚和协作测试**

添加案例证明：
- `apply` 在更改文档之前创建回滚快照
- 回滚恢复上次应用的文档任务快照
- 保留降级请求需要明确的用户确认
- 专家协作呈现结构化问题/决策卡，而不是通用的聊天气泡
- 即使系统建议升级，用户也可以明确关闭任务的深度协作

- [ ] **第 2 步：运行测试以验证失败**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/creator-commit.utils.spec.ts src/ee/ai/creator-commit.runtime.test.ts`
- `python -m pytest agent-service/tests/test_protocol_schemas.py -q`

预计：
- 失败，因为应用/回滚和专家协作尚未建模为文档任务操作

- [ ] **步骤 3：实施应用/回滚和专家协作集成**

Rules:
- `apply` 仅写入已接受的更改
- `rollback` 使用最后保存的快照
- 深度协作仅针对复杂任务、降级请求或歧义解决而出现
- 用户必须能够禁用深度协作并保持仅工作流程执行
- 协作输出必须折叠为 `confirmedDecisions`

- [ ] **第 4 步：重新运行测试**

运行步骤 2 中的相同命令。

预计：
- 通过应用/回滚和结构化协作

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/hooks/use-expert-collab.ts apps/client/src/ee/ai/hooks/ai-create-session.commit.ts apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts apps/server/src/ee/ai/creator-commit.utils.ts apps/server/src/ee/ai/creator-commit.utils.spec.ts apps/server/src/ee/ai/creator-commit.runtime.test.ts apps/server/src/ee/ai/document-tasks/document-tasks.service.ts apps/server/src/ee/ai/ai.controller.ts agent-service/app/schemas/response.py agent-service/tests/test_protocol_schemas.py
git commit -m "feat(ai): add document-task apply rollback and expert collaboration"
```

### 任务 10：切换默认行为、隔离遗留工作台逻辑，并运行回归覆盖

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- 修改：`apps/server/src/ee/ai/ai.controller.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/tests/browser_ai_creator_smoke.py`
- 修改：`agent-service/tests/browser_ai_creator_insert_e2e.py`
- 修改：`agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- 修改：`agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

- [ ] **第 1 步：写出失败的回归期望**

Cover:
- 内联重写默认保持编辑器本地状态
- 文档优化开启文档运营中心
- 大型转换任务仍然可以升级为专家协作
- 空白页起草仍然可以通过合成流程进行

- [ ] **第 2 步：运行回归测试以验证失败**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_insert_e2e.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

预计：
- 失败，直到旧工作台不再是默认 shell

- [ ] **步骤 3：切换默认值并隔离旧路径**

行动：
- 仅当仍需要回滚时，才将旧版聊天/工作台组件保留在内部兼容性切换后面
- 停止通过聊天优先的 UI 路由主线文档优化
- 确保 `section_writer` 不再是默认文档转换路径

- [ ] **第 4 步：重新运行回归**

运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`
- `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_build_diff_set.py agent-service/tests/orchestrator/test_simple_edit.py -q`
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_insert_e2e.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

预计：
- 实时通过新默认设置

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx apps/server/src/ee/ai/ai.controller.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts agent-service/app/orchestrator/engine.py agent-service/tests/browser_ai_creator_smoke.py agent-service/tests/browser_ai_creator_insert_e2e.py agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py agent-service/tests/browser_ai_creator_agent_outline_e2e.py
git commit -m "refactor(ai): cut over to document-task-first creator"
```

## 最终验证

- [ ] 运行客户端单元测试：

```bash
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/hooks/use-document-task.test.tsx apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts
```

- [ ] 运行服务器单元测试：

```bash
pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/document-plan.spec.ts src/ee/ai/document-strategy.spec.ts src/ee/ai/document-tasks/document-tasks.controller.spec.ts src/ee/ai/document-tasks/document-tasks.service.spec.ts src/ee/ai/inline/inline-rewrite.controller.spec.ts src/ee/ai/creator-commit.utils.spec.ts src/ee/ai/creator-commit.runtime.test.ts
```

- [ ] 运行代理服务测试：

```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/orchestrator/test_document_task_engine.py agent-service/tests/orchestrator/test_build_diff_set.py agent-service/tests/orchestrator/test_simple_edit.py agent-service/tests/orchestrator/test_parse_assets_mineru.py agent-service/tests/orchestrator/test_finalize.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_page_asset_parser.py -q
```

- [ ] 运行浏览器回归：

```bash
python agent-service/tests/browser_ai_creator_smoke.py
python agent-service/tests/browser_ai_creator_insert_e2e.py
python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py
python agent-service/tests/browser_ai_creator_agent_outline_e2e.py
```

- [ ] 运行目标类型检查：

```bash
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
```

## 实施者须知

- 请勿在第一个 PR 中拆除旧工作台外壳；首先将其隔离在新任务 shell 后面，然后在浏览器回归变为绿色后删除死代码。
- 将现有的源感知写入更改视为新保存路径的输入，而不是最终产品模型。
- 不要重新引入原始消息历史记录作为文档任务的事实来源。
- 如果严格保存的路径无法安全地处理区块或资产，请将原始内容保留在适当的位置并呈现结构化的风险/决策，而不是默默地重写它。
