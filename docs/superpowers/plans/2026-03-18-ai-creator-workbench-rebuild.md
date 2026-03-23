# AI Creator Workbench 重建实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 将 AI Creator 重建为源驱动、面向会话、树形结构的创建工作台，能够可靠地将证据转化为具有显式 `brief`、`blueprint` 和 `blocking review` 检查点的长格式文档。

**架构：** 后端运行时是一个围绕 `CreationSession`、`EvidenceItem`、`CreationBrief`、`CreationBlueprint`、`DocumentTree`、`ReviewReport` 和可恢复 SSE 事件的显式协调器状态机。前端是一个工作台，它从会话快照中进行恢复，将 `blocked` 视为可恢复的业务状态而不是错误，并从 `draft_patch` 加上文档树状态而不是原始内容块呈现草稿进度。最终状态必须是引用优先、顺序一致、本地可恢复、并且在刷新和工作进程重启时持久。

**技术栈：** FastAPI、Pydantic v2、Python 异步工作线程、NestJS 网关、React、TypeScript、SSE、pnpm、pytest、node:test、Jest、PostgreSQL、Redis

---

## 批准的产品限制

- `Source-driven creation` 是主要启动流程。
- 产品原型是一个`collaborative workbench`，不是一个纯粹的自主代理，也不是一个阶段批准向导。
- 写入策略是`sequential writing for coherence`，默认不是并行段生成。
- 部分失败策略是`local recovery before escalation`。
- 人类检查点保留在`brief`、`blueprint`和`blocking review`。
- `blocked` 和 `error` 是单独的运行时状态和单独的 UI 状态。
- 在任何用户可见的规划或起草之前，所需的证据必须成功。
- 公共运行时身份是`session_id`；旧版 `thread_id` 仅兼容。
- 恢复有效负载必须是显式命令联合，而不是自由格式的松散类型字典。
- 已确认的蓝图是一份书面合同：小幅调整可以自动修补，结构性变更必须重新打开蓝图确认。
- 持久目标状态是规范会话快照和审核历史记录的 `PostgreSQL`，以及热运行时状态、锁定、取消和事件扇出的 `Redis`。

## 当前分支基线

- 下面的`分块 1`已经在`refactor/ai-creator-workbench`上实现。
- 当前内存中的`session_store`是临时基线，而不是目标架构。
- 任何进一步的实施工作都不得绕过该计划或在批准的检查点之外引入新的用户可见阶段。

---

## 分块 1：会话基础与协议基线

### 任务 1：将当前会话/协议基础冻结为正式起点

**文件：**
- 创建：`agent-service/app/models/session.py`
- 创建：`agent-service/app/orchestrator/session_store.py`
- 修改：`agent-service/app/main.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/schemas/response.py`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- 修改：`apps/client/src/ee/ai/types/agent.types.ts`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
- 修改：`apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- 测试： `agent-service/tests/test_protocol_schemas.py`
- 测试： `agent-service/tests/test_main.py`
- 测试： `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- 测试： `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`

- [x] **第 1 步：为会话快照、结构化阻止状态和草稿补丁事件编写失败测试**

运行：
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
```

实施前预期：缺少 `DraftPatchEvent`、缺少 `session_store`、缺少网关会话端点、阻塞态 reducer 不匹配。

- [x] **第 2 步：实现最小后端会话快照和 SSE 合约**

所需行为：
- `session` SSE 事件包括 `session_id`。
- `blocked` SSE 事件包括 `kind`、`required_action`、`allowed_resolutions`。
- `draft_patch` SSE 事件包含完整 Markdown和部分补丁。
- `GET /agent/session/:session_id` 返回当前的 `CreationSessionSnapshot`。

- [x] **第 3 步：实现最小客户端规范化和阻塞状态处理**

所需行为：
- `normalizeAgentRunEvent()` 保留 `session_id`、`draft_patch` 和结构化分块元数据。
- `useAiCreateSession()` 将阻止的事件移至可恢复状态，而不是通用错误路径。

- [x] **步骤 4：重新运行验证并保留此切片作为基线**

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec tsc --noEmit --pretty false
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/services/ai-intent.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
```

预期：全部通过。在未先更新测试的情况下，请勿更改此合同。

---

## 分块 2：公共合约清理与恢复命令语义

### 任务 2：规范化外部会话合约并移除陈旧的用户可见阶段

**文件：**
- 修改：`agent-service/app/schemas/request.py`
- 修改：`agent-service/app/schemas/response.py`
- 修改：`agent-service/app/models/events.py`
- 修改：`agent-service/app/main.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.types.ts`
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- 修改：`apps/client/src/ee/ai/types/agent.types.ts`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- 测试： `agent-service/tests/test_protocol_schemas.py`
- 测试： `agent-service/tests/test_main.py`
- 测试： `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- 测试： `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`

- [ ] **第 1 步：为清理后的公共合约编写失败测试**

所需断言：
- `session_id` 是运行、恢复和快照流上的主要公共标识符。
- 恢复仅接受显式命令：
  - `confirm_brief`
  - `confirm_blueprint`
  - `apply_blueprint_patch`
  - `fix_selected_issues`
  - `resolve_block`
  - `skip_issue`
- 用户可见的 `await_input` 类型仅限于 `brief`、`blueprint` 和 `review`。
- 传统的用户可见停止标签，例如 `clarify`、`propose` 和 `outline` 被删除或映射到仅限内部状态。

运行：
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py -q
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
```

预期：失败，因为当前合约仍然存在兼容性漂移。

- [ ] **第 2 步：实现键入的resume命令 union**

所需行为：
- FastAPI 请求架构和 Nest DTO 接受相同的命令联合。
- 每个命令都有一个稳定的有效负载合同。
- 无效的命令名称或格式错误的有效负载会因显式架构错误而失败，而不是静默强制。

- [ ] **第 3 步：规范公共事件命名和阶段性曝光**

所需行为：
- `session_id` 存在于发出公共状态的任何地方。
- 兼容性 `thread_id` 仍可能包含在内，但仅作为别名。
- 只有`brief`、`blueprint`和`review`成为用户可见的等待输入卡。
- 编排器使用的内部状态不会作为额外的用户可见阶段出现。

- [ ] **第 4 步：运行验证**

运行：
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py -q
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec tsc --noEmit --pretty false
```

预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/schemas/request.py agent-service/app/schemas/response.py agent-service/app/models/events.py agent-service/app/main.py agent-service/app/orchestrator/engine.py apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.types.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/services/ai-create-runner.utils.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
git commit -m "feat(ai-creator): normalize session contract and resume commands"
```

---

## 分块 3：快照恢复与工作台会话恢复

### 任务 3：从 `CreationSessionSnapshot` 恢复前端状态

**文件：**
- 修改：`apps/client/src/ee/ai/services/agent-service.ts`
- 修改：`apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.types.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- 测试： `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **第 1 步：为快照恢复编写失败的客户端测试**

所需断言：
- 现有的 `session_id` 恢复 `status`、`awaitInput`、`block` 和当前草稿 Markdown。
- `awaiting_input`期间刷新重新打开正确的交互卡。
- `blocked`期间刷新不显示一般错误状态。
- 恢复逻辑遵循 `分块 2` 的清洁公共合同。

运行：
```bash
pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
```

预期：失败，因为不存在快照获取或恢复路径。

- [ ] **第 2 步：实现快照获取和reducer恢复逻辑**

所需API：
- add `getAgentSession(sessionId)` in `apps/client/src/ee/ai/services/agent-service.ts`.
- 通过接受 `status`、`awaitInput`、`block`、`draft_markdown` 和 ID 的恢复操作来扩展会话 reducer。

- [ ] **第 3 步：将水化附加到工作台生命周期**

所需行为：
- 当面板打开并带有记住的 `session_id` 时，获取快照一次。
- 如果快照是`awaiting_input`，则重建交互式消息。
- 如果快照是`blocked`，则重建阻塞状态并保持恢复选项可用。
- 如果快照有`draft_markdown`，则将其恢复到实时草稿窗格中。

- [ ] **第 4 步：运行验证**

运行：
```bash
pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
```

预期：通过。

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/services/agent-service.ts apps/client/src/ee/ai/hooks/use-ai-create-session.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.types.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat(ai-creator): hydrate workbench from session snapshots"
```

---

## 分块 4：证据优先运行时与阻塞处理

### 任务 4：用显式证据推导与硬门控替换临时研究触发器

**文件：**
- 创建：`agent-service/app/models/evidence.py`
- 创建：`agent-service/app/orchestrator/tools/evidence.py`
- 修改：`agent-service/app/schemas/request.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/models/session.py`
- 修改：`agent-service/app/main.py`
- 测试： `agent-service/tests/test_protocol_schemas.py`
- 测试： `agent-service/tests/test_main.py`
- 测试： `agent-service/tests/orchestrator/test_e2e_level3.py`
- 测试： `apps/client/src/ee/ai/services/ai-intent.test.ts`

- [ ] **第 1 步：为所需证据门控编写失败的后端测试**

所需断言：
- 在所需证据成功之前，源驱动提示无法发出 `brief`、`blueprint` 或 `draft_patch`。
- 所需证据失败会发出 `blocked(kind="evidence")`。
- 可选的补充研究失败不会硬停止运行。

运行：
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q
```

预期：失败，因为所需的证据仍然隐含。

- [ ] **第 2 步：实施 `EvidenceItem` 推导**

必填字段：
- `kind`
- `source`
- `required`
- `status`
- `purpose`
- `error`

所需的推导规则：
- 当提示需要时，上传的源文档和图像将成为必需的证据。
- 当前页面是继续和转换流程所需的证据。
- 当提示在语义上锚定外部 URL 时，外部 URL 是必需的证据。
- 当任务需要外部新鲜度或缺少事实时，需要进行网络搜索。

- [ ] **步骤 3：在任何用户可见的规划之前实施硬门**

所需的运行时不变量：
- 如果任何必需的证据项不是 `success`，则运行时可能会发出 `step_*` 和 `blocked`，但可能不会发出 `brief` 或 `blueprint` 的 `await_input`，也可能不会发出 `draft_patch`。

- [ ] **步骤 4：将证据状态保留到会话快照中**

必填会话字段：
- 证据摘要
- 失败的证据项目
- 当前块分辨率选择

- [ ] **第 5 步：运行验证**

运行：
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts
```

预期：通过。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/models/evidence.py agent-service/app/orchestrator/tools/evidence.py agent-service/app/schemas/request.py agent-service/app/orchestrator/engine.py agent-service/app/models/session.py agent-service/app/main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py apps/client/src/ee/ai/services/ai-intent.test.ts
git commit -m "feat(ai-creator): enforce evidence-first runtime gating"
```

## 分块 5：蓝图增量策略与 DocumentTree 状态

### 任务 5：明确蓝图确认后哪些变更可以自动补丁

**文件：**
- 修改：`agent-service/app/models/blueprint.py`
- 修改：`agent-service/app/models/session.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/orchestrator/tools/create_blueprint.py`
- 修改：`agent-service/app/orchestrator/tools/user_interaction.py`
- 测试： `agent-service/tests/orchestrator/test_create_blueprint.py`
- 测试： `agent-service/tests/orchestrator/test_e2e_level3.py`
- 测试： `agent-service/tests/test_protocol_schemas.py`

- [ ] **第 1 步：为蓝图增量策略编写失败测试**

所需断言：
- 这些增量可能会自动修补而无需重新打开蓝图确认：
  - `must_cover` 更新
  - `evidence_refs` 重新分配
  - 单部分预算变更在该部分已确认预算的 `+/-15%` 范围内
  - 视觉提示措辞变化不改变图像策略
- 这些增量必须重新打开蓝图确认：
  - 添加或删除部分
  - 重新排序部分
  - 更改标题
  - 总字数预算更改超过 `10%`
  - 改变形象策略

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_protocol_schemas.py -q
```

预期：失败，因为政策尚未明确。

- [ ] **第 2 步：实现蓝图 Delta 分类器**

所需行为：
- 分类器返回 `auto_patch` 或 `reconfirm_blueprint`。
- 当需要重新确认时，会话快照会存储待修复的蓝图以供用户查看。
- 当允许自动修补时，会话审计跟踪会记录更改的内容。

- [ ] **第 3 步：运行验证**

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_protocol_schemas.py -q
```

预期：通过。

### 任务 6：引入 `DocumentTree` 作为主草稿状态

**文件：**
- 创建：`agent-service/app/models/document_tree.py`
- 修改：`agent-service/app/models/session.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/orchestrator/tools/write_tools.py`
- 修改：`agent-service/app/workers/section_writer.py`
- 修改：`agent-service/app/orchestrator/tools/finalize.py`
- 修改：`apps/client/src/ee/ai/types/agent.types.ts`
- 修改：`apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- 测试： `agent-service/tests/orchestrator/test_write_tools.py`
- 测试： `agent-service/tests/workers/test_section_writer.py`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **第 4 步：编写文档树修补的失败测试**

所需断言：
- 每个编写的部分都会更新一个稳定的树节点，而不仅仅是合并markdown。
- `draft_patch` 包括节节点标识和内容。
- Finalize 仍会发出从规范树派生的合并 Markdown 文档。

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/workers/test_section_writer.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts
```

预期：失败，因为草稿状态仍然过于以字符串为中心。

- [ ] **第 5 步：实施 `DocumentNode` 和 `DocumentTree`**

必需的节点字段：
- `node_id`
- `title`
- `level`
- `word_budget`
- `must_cover`
- `evidence_refs`
- `visuals`
- `status`
- `content`
- `summary`

- [ ] **第 6 步：将顺序写入切换为树节点更新**

所需行为：
- 顺序写入仍然是默认值。
- 每个部分写入其自己的节点。
- 每个补丁都会更新 `draft_markdown` 以及规范化的树节点。
- 写入时间和审查时间都强制执行相同的 `+/-10%` 部分预算容限。

- [ ] **第 7 步：运行验证**

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_e2e_level3.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts
```

预期：通过。

- [ ] **第 8 步：提交**

```bash
git add agent-service/app/models/blueprint.py agent-service/app/models/session.py agent-service/app/orchestrator/engine.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/orchestrator/tools/user_interaction.py agent-service/app/models/document_tree.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/workers/section_writer.py agent-service/app/orchestrator/tools/finalize.py apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/hooks/use-ai-create-session.ts agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_protocol_schemas.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/workers/test_section_writer.py apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat(ai-creator): codify blueprint deltas and document tree state"
```

---

## 分块 6：持久化会话存储

### 任务 7：用 PostgreSQL + Redis 持久化替换临时内存会话存储

**文件：**
- 修改：`agent-service/pyproject.toml`
- 修改：`agent-service/app/config.py`
- 创建：`agent-service/app/orchestrator/session_repository.py`
- 创建：`agent-service/app/orchestrator/persistence/postgres_session_store.py`
- 创建：`agent-service/app/orchestrator/persistence/redis_runtime_store.py`
- 修改：`agent-service/app/orchestrator/session_store.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/main.py`
- 测试： `agent-service/tests/test_main.py`
- 测试： `agent-service/tests/test_protocol_schemas.py`
- 创建：`agent-service/tests/test_session_repository.py`

- [ ] **第 1 步：编写持久会话持久性的失败测试**

所需断言：
- 持久化时，规范会话快照可以在进程重新启动后继续存在。
- 审查决策、蓝图确认状态和文档树状态在快照重新加载后仍然存在。
- Redis 支持的热状态在活动运行期间保留取消和恢复语义。
- 开发和测试仍然可以选择显式的 `memory` 后端，但生产默认值不会默默地回退。

运行：
```bash
python -m pytest agent-service/tests/test_main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_session_repository.py -q
```

预期：失败，因为存储仍仅位于内存中。

- [ ] **第 2 步：添加存储库抽象和配置**

所需行为：
- `session_repository.py` 定义快照读/写和审核追加的规范接口。
- 配置支持 `memory` 和 `postgres_redis` 后端。
- 生产目标后端在 PostgreSQL 中存储规范会话快照和审核历史记录。
- Redis 存储活动运行状态、锁、取消标志和事件扇出元数据。

- [ ] **步骤 3：将运行时迁移到存储库支持的会话持久性**

所需行为：
- 引擎状态更新通过存储库写入。
- `GET /agent/session/:session_id` 从存储库读取，而不是进程内存。
- 临时内存实现仍然是仅测试且明确的。

- [ ] **第 4 步：运行验证**

运行：
```bash
python -m pytest agent-service/tests/test_main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_session_repository.py -q
```

预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/pyproject.toml agent-service/app/config.py agent-service/app/orchestrator/session_repository.py agent-service/app/orchestrator/persistence/postgres_session_store.py agent-service/app/orchestrator/persistence/redis_runtime_store.py agent-service/app/orchestrator/session_store.py agent-service/app/orchestrator/engine.py agent-service/app/main.py agent-service/tests/test_main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_session_repository.py
git commit -m "feat(ai-creator): add durable postgres and redis session persistence"
```

---

## 分块 7：写作深化、审查/修复循环与视觉阻塞

### 任务 8：让写作支持本地恢复并让审查可确定性重开

**文件：**
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/workers/section_writer.py`
- 修改：`agent-service/app/workers/evaluator.py`
- 修改：`agent-service/app/orchestrator/tools/fix_tools.py`
- 修改：`agent-service/app/orchestrator/tools/create_blueprint.py`
- 修改：`agent-service/app/workers/visual_planner.py`
- 测试： `agent-service/tests/orchestrator/test_e2e_review.py`
- 测试： `agent-service/tests/orchestrator/test_e2e_level3.py`
- 测试： `agent-service/tests/workers/test_evaluator.py`
- 测试： `agent-service/tests/orchestrator/test_create_blueprint.py`

- [ ] **第 1 步：编写失败测试以进行局部深化和确定性重新审查**

所需断言：
- 部分级重试和深化发生在整个运行失败之前。
- 修复仅重写选定或受影响的部分。
- 视觉生成失败会创建`blocked(kind="visual")`或`ReviewIssue(category="visual")`。
- 最终确定被阻止，而结构、长度、资产或视觉阻止因素仍然存在。

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_create_blueprint.py -q
```

预期：失败，因为本地恢复和全面重新审查仍不完整。

- [ ] **第 2 步：添加节执行状态和本地恢复**

必填部分说明：
- `planned`
- `researching`
- `writing`
- `revising`
- `done`
- `blocked`

所需行为：
- 如果预算或内容失败，请先重试当前部分。
- 在证据不足的情况下，在升级之前进行局部深化。
- 已完成的部分被保留。

- [ ] **第 3 步：加强审查和修复循环**

所需行为：
- 自动修复始终首先运行。
- 仅重写选定的非自动修复问题。
- 修复后，重新运行确定性检查以及全面阻止审查。
- 只能跳过明确可跳过的问题类别，并且每次跳过都会被审核。

- [ ] **第 4 步：实施视觉规划和遮挡**

所需行为：
- `generate_new` 和 `mixed` 必须产生可执行的视觉计划。
- 缺少所需的图像生成必须防止静默完成。

- [ ] **第 5 步：运行验证**

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py -q
```

预期：通过。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/orchestrator/engine.py agent-service/app/workers/section_writer.py agent-service/app/workers/evaluator.py agent-service/app/orchestrator/tools/fix_tools.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/workers/visual_planner.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_create_blueprint.py
git commit -m "feat(ai-creator): add local deepening and deterministic review loop"
```

---

## 分块 8：工作台 UI 收尾与验收

### 任务 9：完善工作台交互模型并运行浏览器验收检查

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- 测试： `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

- [ ] **第 1 步：编写失败的 UI 测试或契约检查以阻止阻塞和文档树渲染**

所需断言：
- 阻塞状态呈现可恢复的操作卡，而不是致命错误。
- 文档树反映了部分补丁状态。
- `brief`、`blueprint` 和 `review` 仍然是唯一面向用户的硬停止卡。

- [ ] **第 2 步：实现屏蔽卡和文档树面板**

所需的 UI 行为：
- 左栏：文档树和部分状态
- 中心栏：实时草稿
- 右栏：证据、简介、蓝图和审查卡
- 聊天仍然是活动日志，而不是唯一的控制界面

- [ ] **步骤 3：运行浏览器级手动验收**

最低场景：
- 上传文档 -> 简介 -> 蓝图 -> 撰写 -> 审核 -> 修复 -> 最终确定
- 源读取失败 -> `blocked(evidence)`
- 图像生成失败 -> `blocked(visual)` 或查看视觉拦截器
- `awaiting_input` 期间刷新 -> 从快照恢复状态

- [ ] **第 4 步：运行最终验证**

运行：
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_session_repository.py -q
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/services/ai-intent.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
```

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat(ai-creator): complete workbench interaction model"
```

---

## 不可协商的接受标准

- 在所需证据成功之前，不会出现用户可见的 `brief`、`blueprint` 或 `draft` 输出。
- `blocked` 保持可恢复并且永远不会通过通用错误路径进行路由。
- 默认情况下，章节写作保持顺序，并在速度上保持连贯性。
- 确定性地审查并修复重新开放，直到解决了阻止程序或在允许的情况下明确跳过。
- Finalize 源自规范文档树，因结构不匹配而关闭失败。
- 浏览器刷新不会丢失活动会话状态。
- 公共合约以`session_id`为中心并键入恢复命令。
- 已确认的蓝图更改遵循明确的自动修补与重新确认策略。
- 规范会话状态通过 PostgreSQL 和 Redis 持久性在进程重新启动后仍然存在。

## 从此时开始的执行规则

- 将此文件视为重建记录的唯一实施计划。
- 在代码更改开始之前，任何新的实施工作都必须映射到上述任务之一。
- 如果设计发生重大变化，请先更新此计划，然后继续实施。
- `分块 2` 是下一个可执行块。在 `分块 2` 完成并验证之前，请勿开始 `分块 3` 或后续工作。
