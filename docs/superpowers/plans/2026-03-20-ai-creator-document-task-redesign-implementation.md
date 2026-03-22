# AI Creator Document-Task Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current chat-first AI Creator workbench with a document-task-first architecture that separates inline rewrite, document operation center, and expert collaboration while preserving uploaded/current-document structure.

**Architecture:** Deliver the redesign in four slices: contract-first API shell, client state and UI cutover, strict-preservation document-task engine, then review/apply/rollback and migration cleanup. Reuse the existing MinerU-first and source-aware parsing investments, but demote section writing to synthesis-only flows; document optimization becomes `diffSet -> pendingChangeSet -> apply/rollback` instead of merged-markdown generation.

**Tech Stack:** React 18, Mantine, Jotai, TypeScript, tsx tests, NestJS, Jest, FastAPI, Pydantic, pytest, Tiptap/Yjs, SSE

**Working Tree:** Execute this plan from `E:\test\Docmost`. Keep the existing source-aware writing changes; this plan repositions them instead of replacing them.

---

## Scope and Sequencing Notes

- This remains one coordinated plan because product cutover, API contracts, and engine routing all pivot on the same new abstraction: `DocumentTask`.
- The first shipping milestone is not "new agent power". It is "correct product boundaries".
- Strict-preservation document optimization must stop defaulting to `brief -> blueprint -> section writer -> merge`.
- Uploaded document optimization should stay `MinerU-first / Docling fallback`.
- Current-page optimization should use editor/page structure first, then feed the same document-task engine.
- Blank-page drafting remains supported, but moves behind the lower-priority synthesis path.

## Success Criteria

- Selection rewrite runs inline by default and does not pollute document-task state.
- Uploaded files stay the default primary source when present, and current-page content joins only on explicit request.
- The right-side panel defaults to a document operation center instead of a chat history.
- Document transform tasks produce typed `diffSet` and `pendingChangeSet` results instead of only merged markdown.
- Final apply creates a rollback snapshot and preserves the original document on failure.
- Deep collaboration can be auto-recommended but can also be turned off per task.
- Strict-preservation rules are enforced for images, tables, code blocks, and Mermaid blocks.
- Section writing is no longer the default path for document optimization; it remains only for synthesis and large-scope drafting.

## File Structure Overview

### New files

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

### Modified files

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

## Chunk 1: Shared Contracts and API Shell

### Task 1: Introduce `DocumentTask` contracts and intent mapping without changing runtime behavior

**Files:**
- Create: `apps/client/src/ee/ai/types/document-task.types.ts`
- Create: `apps/server/src/ee/ai/document-tasks/document-task.types.ts`
- Create: `agent-service/app/models/document_task.py`
- Modify: `apps/client/src/ee/ai/services/ai-intent.ts`
- Modify: `apps/client/src/ee/ai/services/ai-intent.test.ts`
- Modify: `apps/server/src/ee/ai/document-plan.ts`
- Modify: `apps/server/src/ee/ai/document-plan.spec.ts`
- Modify: `apps/server/src/ee/ai/document-strategy.ts`
- Modify: `apps/server/src/ee/ai/document-strategy.spec.ts`
- Modify: `agent-service/app/schemas/document_contracts.py`
- Modify: `agent-service/app/schemas/request.py`
- Modify: `agent-service/app/schemas/response.py`
- Test: `agent-service/tests/test_protocol_schemas.py`

- [ ] **Step 1: Write the failing contract tests**

Add cases for:
- `document_transform` defaulting to strict preservation
- uploaded files becoming the primary source by default when present
- current-page content joining uploaded-source transforms only on explicit request
- relaxed optimization remaining a constrained document-transform mode instead of unrestricted redrafting
- structured-summary inheritance instead of raw message-history inheritance
- mixed-granularity diff metadata
- explicit `apply` and `rollback` payload shapes

- [ ] **Step 2: Run the contract tests to verify failure**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/document-plan.spec.ts src/ee/ai/document-strategy.spec.ts`
- `python -m pytest agent-service/tests/test_protocol_schemas.py -q`

Expected:
- client tests fail because `ai-intent.ts` only returns route/scope/policy, not document-task mode metadata
- schema tests fail because the agent protocol does not expose `DocumentTask` fields yet

- [ ] **Step 3: Implement typed task contracts**

Add one shared conceptual shape across the three layers:

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

Mirror the same concepts in `document_contracts.py` and `document_task.py`, while keeping old request fields accepted for compatibility.

Also normalize source-scope rules in `ai-intent.ts` and `document-strategy.ts` so the contract explicitly supports:
- `uploaded_document`
- `current_page`
- `uploaded_plus_current_page`

and includes relaxed-mode guardrails for preserved meaning and image-text correspondence.

- [ ] **Step 4: Re-run tests to verify the contract layer passes**

Run the same commands from Step 2.

Expected:
- PASS with new types in place and no behavior change yet

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/types/document-task.types.ts apps/client/src/ee/ai/services/ai-intent.ts apps/client/src/ee/ai/services/ai-intent.test.ts apps/server/src/ee/ai/document-tasks/document-task.types.ts apps/server/src/ee/ai/document-plan.ts apps/server/src/ee/ai/document-plan.spec.ts apps/server/src/ee/ai/document-strategy.ts apps/server/src/ee/ai/document-strategy.spec.ts agent-service/app/models/document_task.py agent-service/app/schemas/document_contracts.py agent-service/app/schemas/request.py agent-service/app/schemas/response.py agent-service/tests/test_protocol_schemas.py
git commit -m "feat(ai): add shared document-task contracts"
```

### Task 2: Add Nest and client document-task API shell while keeping old endpoints alive

**Files:**
- Create: `apps/client/src/ee/ai/services/document-task-service.ts`
- Create: `apps/server/src/ee/ai/document-tasks/document-tasks.controller.ts`
- Create: `apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- Create: `apps/server/src/ee/ai/document-tasks/document-tasks.controller.spec.ts`
- Create: `apps/server/src/ee/ai/document-tasks/document-tasks.service.spec.ts`
- Modify: `apps/server/src/ee/ai/ai.module.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts`
- Modify: `apps/client/src/ee/ai/services/agent-service.ts`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.ts`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **Step 1: Write failing endpoint and client tests**

Add coverage for:
- `POST /ai/document-tasks`
- `POST /ai/document-tasks/:taskId/plan`
- `POST /ai/document-tasks/:taskId/diff`
- `POST /ai/document-tasks/:taskId/review`
- `POST /ai/document-tasks/:taskId/apply`
- `POST /ai/document-tasks/:taskId/rollback`
- `POST /ai/document-tasks/:taskId/collab`

- [ ] **Step 2: Run tests to verify failure**

Run:
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/document-tasks/document-tasks.controller.spec.ts src/ee/ai/document-tasks/document-tasks.service.spec.ts src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`

Expected:
- FAIL because the document-task controller/service and client service do not exist

- [ ] **Step 3: Implement the API shell with compatibility adapters**

The first version may proxy into existing gateway/orchestrator behavior, but the new public shape must already be task-centered:
- `createTask()`
- `requestPlan()`
- `requestDiff()`
- `submitReview()`
- `applyAcceptedChanges()`
- `rollbackAppliedChanges()`
- `resolveCollabDecision()`

- [ ] **Step 4: Re-run tests to verify the shell passes**

Run the same commands from Step 2.

Expected:
- PASS with old `/ai/creator/generate` and `/agent/run` still intact for compatibility

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/services/document-task-service.ts apps/client/src/ee/ai/services/agent-service.ts apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/server/src/ee/ai/ai.module.ts apps/server/src/ee/ai/document-tasks/document-tasks.controller.ts apps/server/src/ee/ai/document-tasks/document-tasks.service.ts apps/server/src/ee/ai/document-tasks/document-tasks.controller.spec.ts apps/server/src/ee/ai/document-tasks/document-tasks.service.spec.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts
git commit -m "feat(ai): add document-task api shell"
```

### Task 2A: Add a dedicated inline-rewrite API and keep it separate from document-task endpoints

**Files:**
- Create: `apps/client/src/ee/ai/services/inline-rewrite-service.ts`
- Create: `apps/server/src/ee/ai/inline/inline-rewrite.controller.ts`
- Create: `apps/server/src/ee/ai/inline/inline-rewrite.service.ts`
- Create: `apps/server/src/ee/ai/inline/inline-rewrite.controller.spec.ts`
- Modify: `apps/server/src/ee/ai/ai.module.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-inline-rewrite.ts`
- Modify: `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.ts`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- Modify: `agent-service/app/orchestrator/tools/simple_edit.py`
- Modify: `agent-service/tests/orchestrator/test_simple_edit.py`

- [ ] **Step 1: Write the failing inline API tests**

Add coverage for:
- `POST /ai/inline/rewrite`
- request payload containing `selectionSnapshot`, `localContext`, `action`, and optional `taskSummaryRef`
- response payload containing `candidate`, `riskFlags`, and allowed insert/replace options

- [ ] **Step 2: Run tests to verify failure**

Run:
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/inline/inline-rewrite.controller.spec.ts`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `python -m pytest agent-service/tests/orchestrator/test_simple_edit.py -q`

Expected:
- FAIL because inline rewrite still rides legacy creator/session plumbing instead of a dedicated contract

- [ ] **Step 3: Implement the dedicated inline contract**

Rules:
- inline rewrite remains a separate API surface from `DocumentTask`
- it uses the inline rewrite engine path, not document-task review/apply endpoints
- it may read structured task summary references, but never raw document-task history

- [ ] **Step 4: Re-run tests**

Run the same commands from Step 2.

Expected:
- PASS with a dedicated inline contract in place

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/services/inline-rewrite-service.ts apps/server/src/ee/ai/inline/inline-rewrite.controller.ts apps/server/src/ee/ai/inline/inline-rewrite.service.ts apps/server/src/ee/ai/inline/inline-rewrite.controller.spec.ts apps/server/src/ee/ai/ai.module.ts apps/client/src/ee/ai/hooks/use-inline-rewrite.ts apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts agent-service/app/orchestrator/tools/simple_edit.py agent-service/tests/orchestrator/test_simple_edit.py
git commit -m "feat(ai): add dedicated inline rewrite api"
```

## Chunk 2: Client State and UI Cutover

### Task 3: Split `use-ai-create-session` into focused task hooks

**Files:**
- Create: `apps/client/src/ee/ai/hooks/use-document-task.ts`
- Create: `apps/client/src/ee/ai/hooks/use-inline-rewrite.ts`
- Create: `apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts`
- Create: `apps/client/src/ee/ai/hooks/use-expert-collab.ts`
- Create: `apps/client/src/ee/ai/hooks/use-document-task.test.tsx`
- Modify: `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`

- [ ] **Step 1: Write failing hook and reducer tests**

Add tests proving:
- document-task summary inheritance excludes raw message history
- inline rewrite state is independent from document-task state
- expert collaboration state stores structured decisions, not generic messages

- [ ] **Step 2: Run tests to verify failure**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/hooks/use-document-task.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`

Expected:
- FAIL because the current reducer still assumes a session/message-first model

- [ ] **Step 3: Implement focused hooks and leave `use-ai-create-session` as a temporary adapter**

Rules:
- `use-document-task` owns `taskSummary`, `plan`, `diffSet`, `pendingChangeSet`, and task status
- `use-inline-rewrite` owns selection snapshot and preview result only
- `use-expert-collab` owns pending questions and confirmed decisions only
- `use-ai-create-session` may remain temporarily, but it should delegate instead of owning the new state itself

- [ ] **Step 4: Re-run tests**

Run the same command from Step 2.

Expected:
- PASS with the new state split and compatibility adapter still compiling

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/hooks/use-document-task.ts apps/client/src/ee/ai/hooks/use-inline-rewrite.ts apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts apps/client/src/ee/ai/hooks/use-expert-collab.ts apps/client/src/ee/ai/hooks/use-document-task.test.tsx apps/client/src/ee/ai/hooks/use-ai-create-session.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
git commit -m "refactor(client): split ai creator state by task type"
```

### Task 4: Replace the right-side workbench with a document operation center shell

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-session.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests proving:
- the panel defaults to task header + mode/source controls + diff review + pending change bar
- `DocumentTreePanel`, live draft, and generic message history are no longer the default center of the panel
- the panel can render a plan-confirmation state without pretending it is a chat thread
- the panel visibly shows structured task summary and explicit apply/rollback controls

- [ ] **Step 2: Run tests to verify failure**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`

Expected:
- FAIL because the current panel still renders the workbench/session shell

- [ ] **Step 3: Implement the panel cutover**

Default visual order:
1. task header
2. source scope + mode controls
3. plan or diff workspace
4. pending change bar

Do not render a message transcript as the primary layout.
Make the structured task summary, plan preview, and apply/rollback affordances visible without entering expert collaboration.

- [ ] **Step 4: Re-run tests and typecheck**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`

Expected:
- PASS with the new shell in place

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-session.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx
git commit -m "feat(client): cut over ai creator to document operation center"
```

### Task 5: Keep selection rewrite inline and isolated from document tasks

**Files:**
- Modify: `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx`
- Modify: `apps/client/src/ee/ai/components/editor/ai-menu/result-preview.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.test.ts`
- Modify: `apps/server/src/ee/ai/creator-commit.utils.ts`
- Modify: `apps/server/src/ee/ai/creator-commit.utils.spec.ts`
- Modify: `apps/server/src/ee/ai/creator-commit.runtime.test.ts`
- Modify: `agent-service/app/orchestrator/tools/simple_edit.py`
- Modify: `agent-service/tests/orchestrator/test_simple_edit.py`

- [ ] **Step 1: Write failing tests for selection isolation**

Add cases proving:
- selection rewrite reads `selectionSnapshot + localContext + structuredTaskSummaryRef`
- selection rewrite does not inherit raw message history
- stale selection replacement fails safely instead of silently downgrading to append for default inline rewrite

- [ ] **Step 2: Run tests to verify failure**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/creator-commit.utils.spec.ts src/ee/ai/creator-commit.runtime.test.ts`
- `python -m pytest agent-service/tests/orchestrator/test_simple_edit.py -q`

Expected:
- FAIL because the current writeback path allows selection drift and the inline flow still shares too much session state

- [ ] **Step 3: Implement isolation rules**

Rules:
- default inline rewrite is a short-lived task
- it may read structured task summary only
- it must not mutate the active document-task diff set
- stale selection writes should surface a recoverable conflict instead of silent append

- [ ] **Step 4: Re-run tests**

Run the same commands from Step 2.

Expected:
- PASS with selection rewrite isolated and safer writeback semantics

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx apps/client/src/ee/ai/components/editor/ai-menu/result-preview.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.test.ts apps/server/src/ee/ai/creator-commit.utils.ts apps/server/src/ee/ai/creator-commit.utils.spec.ts apps/server/src/ee/ai/creator-commit.runtime.test.ts agent-service/app/orchestrator/tools/simple_edit.py agent-service/tests/orchestrator/test_simple_edit.py
git commit -m "fix(ai): isolate inline rewrite from document tasks"
```

## Chunk 3: Document Task Engine and Preservation Parsing

### Task 6: Introduce `DocumentTaskEngine` and route tasks by workflow instead of by chat/session

**Files:**
- Create: `agent-service/app/orchestrator/document_task_engine.py`
- Create: `agent-service/tests/orchestrator/test_document_task_engine.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/models/state.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/orchestrator/tools/complexity.py`
- Modify: `agent-service/app/orchestrator/tools/evidence.py`
- Modify: `agent-service/tests/test_main.py`
- Modify: `agent-service/tests/orchestrator/test_engine.py`
- Modify: `agent-service/tests/orchestrator/test_complexity.py`

- [ ] **Step 1: Write failing engine-routing tests**

Add cases proving:
- selection rewrite uses `Inline Rewrite` behavior
- document transform in strict mode uses `Preservation Patch Flow`
- blank-page drafting and relaxed large-scope rewrite use `Draft/Synthesis Flow`
- expert collaboration is a sub-state, not a third independent engine

- [ ] **Step 2: Run tests to verify failure**

Run:
- `python -m pytest agent-service/tests/orchestrator/test_document_task_engine.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_complexity.py agent-service/tests/test_main.py -q`

Expected:
- FAIL because current routing is still centered on Level 1/2/3 orchestrator paths

- [ ] **Step 3: Implement the engine split**

Keep compatibility:
- existing `OrchestratorEngine` may remain as a lower-level helper
- `DocumentTaskEngine` becomes the public decision point
- selection rewrite, preservation patch, and synthesis should be explicit branches

- [ ] **Step 4: Re-run tests**

Run the same command from Step 2.

Expected:
- PASS with task-first routing in place

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/document_task_engine.py agent-service/tests/orchestrator/test_document_task_engine.py agent-service/app/main.py agent-service/app/models/state.py agent-service/app/orchestrator/engine.py agent-service/app/orchestrator/tools/complexity.py agent-service/app/orchestrator/tools/evidence.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_complexity.py
git commit -m "refactor(agent-service): route ai work through document task engine"
```

### Task 6A: Make blank-page drafting and multi-document synthesis explicit workflow branches

**Files:**
- Modify: `agent-service/app/orchestrator/document_task_engine.py`
- Modify: `agent-service/app/orchestrator/tools/create_brief.py`
- Modify: `agent-service/app/orchestrator/tools/create_blueprint.py`
- Modify: `agent-service/app/orchestrator/tools/user_interaction.py`
- Modify: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx`
- Modify: `agent-service/tests/orchestrator/test_e2e_level3.py`
- Modify: `agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

- [ ] **Step 1: Write failing drafting and synthesis tests**

Add cases proving:
- small blank-page drafting requests can draft directly without unnecessary planning
- large blank-page drafting requests require brief or outline confirmation first
- multi-document synthesis enters explicit conflict-resolution/collaboration when sources disagree

- [ ] **Step 2: Run tests to verify failure**

Run:
- `python -m pytest agent-service/tests/orchestrator/test_e2e_level3.py -q`
- `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

Expected:
- FAIL because blank-page drafting and multi-document synthesis are not yet decomposed into explicit guarded workflows

- [ ] **Step 3: Implement explicit synthesis branches**

Rules:
- small blank-page tasks may draft directly
- large blank-page tasks must gate on brief/outline confirmation
- multi-document synthesis must surface structured conflicts into collaboration instead of silently merging contradictory material

- [ ] **Step 4: Re-run tests**

Run the same commands from Step 2.

Expected:
- PASS with explicit drafting/synthesis workflow boundaries

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/document_task_engine.py agent-service/app/orchestrator/tools/create_brief.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/orchestrator/tools/user_interaction.py apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/browser_ai_creator_agent_outline_e2e.py
git commit -m "feat(ai): make drafting and synthesis workflows explicit"
```

### Task 7: Add current-page asset parsing and preserve uploaded/current-page evidence in one patch flow

**Files:**
- Create: `agent-service/app/workers/page_asset_parser.py`
- Create: `agent-service/tests/workers/test_page_asset_parser.py`
- Modify: `agent-service/app/workers/asset_parser.py`
- Modify: `agent-service/app/orchestrator/tools/parse_assets.py`
- Modify: `agent-service/app/orchestrator/tools/evidence.py`
- Modify: `agent-service/app/orchestrator/tools/finalize.py`
- Modify: `agent-service/tests/workers/test_asset_parser.py`
- Modify: `agent-service/tests/workers/test_page_asset_parser.py`
- Modify: `agent-service/tests/orchestrator/test_parse_assets.py`
- Modify: `agent-service/tests/orchestrator/test_parse_assets_mineru.py`
- Modify: `apps/server/src/ee/ai/evidence-preflight.ts`
- Modify: `apps/server/src/ee/ai/evidence-preflight.spec.ts`

- [ ] **Step 1: Write failing parsing tests**

Add cases proving:
- current-page optimization yields asset-aware blocks for images, tables, and code blocks
- uploaded-file optimization stays MinerU-first / Docling fallback
- strict mode retains original image placement metadata and skips unsafe table/code transformations instead of flattening them

- [ ] **Step 2: Run tests to verify failure**

Run:
- `python -m pytest agent-service/tests/workers/test_asset_parser.py agent-service/tests/workers/test_page_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts`

Expected:
- FAIL because current-page evidence is still mostly raw markdown/context, not asset-aware structure

- [ ] **Step 3: Implement unified preservation parsing**

Rules:
- uploaded files: `MinerU-first -> Docling fallback`
- current page: editor/page structure first
- both outputs normalize into one asset-aware block map
- strict mode keeps image placement fixed when uncertain
- strict mode leaves unsafe tables/code/Mermaid blocks unchanged in place

- [ ] **Step 4: Re-run tests**

Run the same commands from Step 2.

Expected:
- PASS with one preservation-aware evidence contract

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/page_asset_parser.py agent-service/tests/workers/test_page_asset_parser.py agent-service/app/workers/asset_parser.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/orchestrator/tools/evidence.py agent-service/app/orchestrator/tools/finalize.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_mineru.py apps/server/src/ee/ai/evidence-preflight.ts apps/server/src/ee/ai/evidence-preflight.spec.ts
git commit -m "feat(agent-service): unify uploaded and page evidence for preservation patch flow"
```

## Chunk 4: Diff Review, Apply/Rollback, and Migration Cleanup

### Task 8: Generate `diffSet` and `pendingChangeSet` instead of merged-markdown-first output

**Files:**
- Create: `agent-service/app/orchestrator/tools/build_diff_set.py`
- Create: `agent-service/tests/orchestrator/test_build_diff_set.py`
- Modify: `agent-service/app/orchestrator/tools/finalize.py`
- Modify: `agent-service/app/orchestrator/tools/write_tools.py`
- Modify: `agent-service/app/workers/section_writer.py`
- Modify: `agent-service/tests/orchestrator/test_write_tools.py`
- Modify: `agent-service/tests/orchestrator/test_finalize.py`
- Modify: `agent-service/tests/workers/test_section_writer.py`
- Modify: `apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx`

- [ ] **Step 1: Write failing diff-generation tests**

Add cases proving:
- strict-preservation document transform produces block-level diff entries
- text blocks can expose finer text diffs
- relaxed optimization may reorder structure but must preserve meaning and image-text correspondence
- section writer is no longer the default path for document transform
- section writer remains available for synthesis-only tasks

- [ ] **Step 2: Run tests to verify failure**

Run:
- `python -m pytest agent-service/tests/orchestrator/test_build_diff_set.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_finalize.py agent-service/tests/workers/test_section_writer.py -q`
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`

Expected:
- FAIL because current finalize/write flow still favors merged markdown

- [ ] **Step 3: Implement diff-first output**

Rules:
- document transform returns `diffSet`, `assetImpact`, `riskFlags`
- accepted items accumulate in `pendingChangeSet`
- relaxed optimization may change structure, but it must keep meaning and image-text correspondence intact
- section writing stays behind synthesis flow only

- [ ] **Step 4: Re-run tests**

Run the same commands from Step 2.

Expected:
- PASS with diff-first document optimization

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/build_diff_set.py agent-service/tests/orchestrator/test_build_diff_set.py agent-service/app/orchestrator/tools/finalize.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/workers/section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_finalize.py agent-service/tests/workers/test_section_writer.py apps/server/src/ee/ai/document-tasks/document-tasks.service.ts apps/client/src/ee/ai/hooks/use-task-apply-rollback.ts apps/client/src/ee/ai/components/ai-creator/document-task/DiffReviewPanel.tsx
git commit -m "feat(ai): make document transform diff-first"
```

### Task 9: Hook apply/rollback to the existing commit safety path and expose expert collaboration

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- Modify: `apps/client/src/ee/ai/hooks/use-expert-collab.ts`
- Modify: `apps/client/src/ee/ai/hooks/ai-create-session.commit.ts`
- Modify: `apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts`
- Modify: `apps/server/src/ee/ai/creator-commit.utils.ts`
- Modify: `apps/server/src/ee/ai/creator-commit.utils.spec.ts`
- Modify: `apps/server/src/ee/ai/creator-commit.runtime.test.ts`
- Modify: `apps/server/src/ee/ai/document-tasks/document-tasks.service.ts`
- Modify: `apps/server/src/ee/ai/ai.controller.ts`
- Modify: `agent-service/app/schemas/response.py`
- Modify: `agent-service/tests/test_protocol_schemas.py`

- [ ] **Step 1: Write failing apply/rollback and collaboration tests**

Add cases proving:
- `apply` creates a rollback snapshot before mutating the document
- rollback restores the last applied document-task snapshot
- preservation downgrade requests require explicit user confirmation
- expert collaboration renders structured question/decision cards, not generic chat bubbles
- users can explicitly turn deep collaboration off for a task even when the system recommends escalation

- [ ] **Step 2: Run tests to verify failure**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx`
- `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/creator-commit.utils.spec.ts src/ee/ai/creator-commit.runtime.test.ts`
- `python -m pytest agent-service/tests/test_protocol_schemas.py -q`

Expected:
- FAIL because apply/rollback and expert collaboration are not yet modeled as document-task operations

- [ ] **Step 3: Implement apply/rollback and expert-collab integration**

Rules:
- `apply` writes accepted changes only
- `rollback` uses the last saved snapshot
- deep collaboration appears only for complex tasks, downgrade requests, or ambiguity resolution
- users must be able to disable deep collaboration and stay on workflow-only execution
- collaboration output must collapse into `confirmedDecisions`

- [ ] **Step 4: Re-run tests**

Run the same commands from Step 2.

Expected:
- PASS with apply/rollback and structured collaboration in place

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/expert-collab/ExpertCollabPanel.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx apps/client/src/ee/ai/components/ai-creator/document-task/PendingChangeBar.tsx apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/hooks/use-expert-collab.ts apps/client/src/ee/ai/hooks/ai-create-session.commit.ts apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts apps/server/src/ee/ai/creator-commit.utils.ts apps/server/src/ee/ai/creator-commit.utils.spec.ts apps/server/src/ee/ai/creator-commit.runtime.test.ts apps/server/src/ee/ai/document-tasks/document-tasks.service.ts apps/server/src/ee/ai/ai.controller.ts agent-service/app/schemas/response.py agent-service/tests/test_protocol_schemas.py
git commit -m "feat(ai): add document-task apply rollback and expert collaboration"
```

### Task 10: Cut over defaults, quarantine legacy workbench behavior, and run regression coverage

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- Modify: `apps/server/src/ee/ai/ai.controller.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/tests/browser_ai_creator_smoke.py`
- Modify: `agent-service/tests/browser_ai_creator_insert_e2e.py`
- Modify: `agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- Modify: `agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

- [ ] **Step 1: Write failing regression expectations**

Cover:
- inline rewrite remains editor-local by default
- document optimization opens the document operation center
- large transform tasks can still escalate into expert collaboration
- blank-page drafting still works through synthesis flow

- [ ] **Step 2: Run regression tests to verify failure**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_insert_e2e.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

Expected:
- FAIL until the legacy workbench is no longer the default shell

- [ ] **Step 3: Cut over defaults and quarantine legacy paths**

Actions:
- keep legacy chat/workbench components behind an internal compatibility toggle only if still needed for rollback
- stop routing mainline document optimization through chat-first UI
- ensure `section_writer` is no longer the default document-transform path

- [ ] **Step 4: Re-run regressions**

Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-session.test.ts`
- `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_build_diff_set.py agent-service/tests/orchestrator/test_simple_edit.py -q`
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_insert_e2e.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py`

Expected:
- PASS with the new defaults live

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx apps/server/src/ee/ai/ai.controller.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts agent-service/app/orchestrator/engine.py agent-service/tests/browser_ai_creator_smoke.py agent-service/tests/browser_ai_creator_insert_e2e.py agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py agent-service/tests/browser_ai_creator_agent_outline_e2e.py
git commit -m "refactor(ai): cut over to document-task-first creator"
```

## Final Verification

- [ ] Run client unit tests:

```bash
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.test.tsx apps/client/src/ee/ai/hooks/use-document-task.test.tsx apps/client/src/ee/ai/hooks/ai-create-session.commit.test.ts
```

- [ ] Run server unit tests:

```bash
pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/document-plan.spec.ts src/ee/ai/document-strategy.spec.ts src/ee/ai/document-tasks/document-tasks.controller.spec.ts src/ee/ai/document-tasks/document-tasks.service.spec.ts src/ee/ai/inline/inline-rewrite.controller.spec.ts src/ee/ai/creator-commit.utils.spec.ts src/ee/ai/creator-commit.runtime.test.ts
```

- [ ] Run agent-service tests:

```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/orchestrator/test_document_task_engine.py agent-service/tests/orchestrator/test_build_diff_set.py agent-service/tests/orchestrator/test_simple_edit.py agent-service/tests/orchestrator/test_parse_assets_mineru.py agent-service/tests/orchestrator/test_finalize.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_page_asset_parser.py -q
```

- [ ] Run browser regressions:

```bash
python agent-service/tests/browser_ai_creator_smoke.py
python agent-service/tests/browser_ai_creator_insert_e2e.py
python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py
python agent-service/tests/browser_ai_creator_agent_outline_e2e.py
```

- [ ] Run targeted typecheck:

```bash
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
```

## Notes for the Implementer

- Do not remove the old workbench shell in the first PR; first isolate it behind the new task shell, then delete dead code once the browser regressions are green.
- Treat existing source-aware writing changes as inputs to the new preservation path, not as the final product model.
- Do not reintroduce raw message history as the source of truth for document tasks.
- If a strict-preservation path cannot safely handle a block or asset, keep the original content in place and surface a structured risk/decision instead of silently rewriting it.
