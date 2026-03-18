# AI Creator Workbench Rebuild Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild AI Creator into a source-driven, session-oriented, tree-structured creation workbench that can reliably turn evidence into long-form documents with explicit `brief`, `blueprint`, and `blocking review` checkpoints.

**Architecture:** The backend runtime is an explicit orchestrator state machine around `CreationSession`, `EvidenceItem`, `CreationBrief`, `CreationBlueprint`, `DocumentTree`, `ReviewReport`, and resumable SSE events. The frontend is a workbench that hydrates from session snapshots, treats `blocked` as recoverable business state rather than error, and renders draft progress from `draft_patch` plus document-tree state instead of raw content chunks. The end state must be reference-first, sequential for coherence, locally recoverable, and durable across refreshes and worker restarts.

**Tech Stack:** FastAPI, Pydantic v2, Python async workers, NestJS gateway, React, TypeScript, SSE, pnpm, pytest, node:test, Jest, PostgreSQL, Redis

---

## Approved Product Constraints

- `Source-driven creation` is the primary launch flow.
- Product archetype is a `collaborative workbench`, not a pure autonomous agent and not a stage-approval wizard.
- Writing strategy is `sequential writing for coherence`, not parallel section generation by default.
- Section failure policy is `local recovery before escalation`.
- Human checkpoints remain at `brief`, `blueprint`, and `blocking review`.
- `blocked` and `error` are separate runtime states and separate UI states.
- Required evidence must succeed before any user-visible planning or drafting.
- Public runtime identity is `session_id`; legacy `thread_id` is compatibility-only.
- Resume payloads must be an explicit command union, not free-form loosely typed dicts.
- A confirmed blueprint is a writing contract: minor deltas may auto-patch, structural deltas must reopen blueprint confirmation.
- Durable target state is `PostgreSQL` for canonical session snapshots and audit history plus `Redis` for hot runtime state, locks, cancellation, and event fanout.

## Current Branch Baseline

- `Chunk 1` below is already implemented on `refactor/ai-creator-workbench`.
- The current in-memory `session_store` is a temporary baseline, not the target architecture.
- No further implementation work may bypass this plan or introduce new user-visible stages outside the approved checkpoints.

---

## Chunk 1: Session Foundation and Protocol Baseline

### Task 1: Freeze the current session/protocol foundation as the official starting point

**Files:**
- Create: `agent-service/app/models/session.py`
- Create: `agent-service/app/orchestrator/session_store.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/schemas/response.py`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- Modify: `apps/client/src/ee/ai/types/agent.types.ts`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- Test: `agent-service/tests/test_protocol_schemas.py`
- Test: `agent-service/tests/test_main.py`
- Test: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- Test: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`

- [x] **Step 1: Write failing tests for session snapshot, structured blocked state, and draft patch events**

Run:
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
```

Expected before implementation: missing `DraftPatchEvent`, missing `session_store`, missing gateway session endpoint, blocked reducer mismatch.

- [x] **Step 2: Implement minimal backend session snapshot and SSE contract**

Required behavior:
- `session` SSE event includes `session_id`.
- `blocked` SSE event includes `kind`, `required_action`, `allowed_resolutions`.
- `draft_patch` SSE event carries full markdown plus section patches.
- `GET /agent/session/:session_id` returns the current `CreationSessionSnapshot`.

- [x] **Step 3: Implement minimal client normalization and blocked-state handling**

Required behavior:
- `normalizeAgentRunEvent()` preserves `session_id`, `draft_patch`, and structured blocked metadata.
- `useAiCreateSession()` moves blocked events into recoverable state instead of the generic error path.

- [x] **Step 4: Re-run verification and keep this slice as the baseline**

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec tsc --noEmit --pretty false
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/services/ai-intent.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
```

Expected: all pass. Do not change this contract without updating tests first.

---

## Chunk 2: Public Contract Cleanup and Resume Command Semantics

### Task 2: Normalize the external session contract and remove stale user-visible phases

**Files:**
- Modify: `agent-service/app/schemas/request.py`
- Modify: `agent-service/app/schemas/response.py`
- Modify: `agent-service/app/models/events.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.types.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- Modify: `apps/client/src/ee/ai/types/agent.types.ts`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- Test: `agent-service/tests/test_protocol_schemas.py`
- Test: `agent-service/tests/test_main.py`
- Test: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- Test: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts`

- [ ] **Step 1: Write failing tests for the cleaned public contract**

Required assertions:
- `session_id` is the primary public identifier on run, resume, and snapshot flows.
- resume accepts only explicit commands:
  - `confirm_brief`
  - `confirm_blueprint`
  - `apply_blueprint_patch`
  - `fix_selected_issues`
  - `resolve_block`
  - `skip_issue`
- user-visible `await_input` types are limited to `brief`, `blueprint`, and `review`.
- legacy user-visible stop labels such as `clarify`, `propose`, and `outline` are either removed or mapped to internal-only state.

Run:
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py -q
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
```

Expected: FAIL because the current contract still carries compatibility drift.

- [ ] **Step 2: Implement the typed resume command union**

Required behavior:
- FastAPI request schema and Nest DTO accept the same command union.
- each command has a stable payload contract.
- invalid command names or malformed payloads fail with explicit schema errors, not silent coercion.

- [ ] **Step 3: Normalize public event naming and phase exposure**

Required behavior:
- `session_id` is present everywhere public state is emitted.
- compatibility `thread_id` may still be included, but only as an alias.
- only `brief`, `blueprint`, and `review` become user-visible await-input cards.
- internal states used by the orchestrator are not surfaced as extra user-visible stages.

- [ ] **Step 4: Run verification**

Run:
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py -q
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/schemas/request.py agent-service/app/schemas/response.py agent-service/app/models/events.py agent-service/app/main.py agent-service/app/orchestrator/engine.py apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.types.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/services/ai-create-runner.utils.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
git commit -m "feat(ai-creator): normalize session contract and resume commands"
```

---

## Chunk 3: Snapshot Hydration and Workbench Session Recovery

### Task 3: Hydrate the frontend from `CreationSessionSnapshot`

**Files:**
- Modify: `apps/client/src/ee/ai/services/agent-service.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.types.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts`
- Test: `apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **Step 1: Write failing client tests for snapshot hydration**

Required assertions:
- existing `session_id` restores `status`, `awaitInput`, `block`, and current draft markdown.
- refresh during `awaiting_input` reopens the correct interactive card.
- refresh during `blocked` does not show a generic error state.
- hydration follows the cleaned public contract from `Chunk 2`.

Run:
```bash
pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
```

Expected: FAIL because no snapshot fetch or hydration path exists.

- [ ] **Step 2: Implement snapshot fetch and reducer hydration**

Required API:
- add `getAgentSession(sessionId)` in `apps/client/src/ee/ai/services/agent-service.ts`.
- extend the session reducer with a hydration action that accepts `status`, `awaitInput`, `block`, `draft_markdown`, and IDs.

- [ ] **Step 3: Attach hydration to the workbench lifecycle**

Required behavior:
- when the panel opens with a remembered `session_id`, fetch snapshot once.
- if snapshot is `awaiting_input`, rebuild the interactive message.
- if snapshot is `blocked`, rebuild the blocked state and keep resume options available.
- if snapshot has `draft_markdown`, restore it into the live draft pane.

- [ ] **Step 4: Run verification**

Run:
```bash
pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/services/agent-service.ts apps/client/src/ee/ai/hooks/use-ai-create-session.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.types.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat(ai-creator): hydrate workbench from session snapshots"
```

---

## Chunk 4: Evidence-First Runtime and Block Resolution

### Task 4: Replace the ad-hoc research trigger with explicit evidence derivation and hard gating

**Files:**
- Create: `agent-service/app/models/evidence.py`
- Create: `agent-service/app/orchestrator/tools/evidence.py`
- Modify: `agent-service/app/schemas/request.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/models/session.py`
- Modify: `agent-service/app/main.py`
- Test: `agent-service/tests/test_protocol_schemas.py`
- Test: `agent-service/tests/test_main.py`
- Test: `agent-service/tests/orchestrator/test_e2e_level3.py`
- Test: `apps/client/src/ee/ai/services/ai-intent.test.ts`

- [ ] **Step 1: Write failing backend tests for required-evidence gating**

Required assertions:
- source-driven prompts cannot emit `brief`, `blueprint`, or `draft_patch` before required evidence succeeds.
- required evidence failure emits `blocked(kind="evidence")`.
- optional supplementary research failure does not hard-stop the run.

Run:
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q
```

Expected: FAIL because required evidence is still implicit.

- [ ] **Step 2: Implement `EvidenceItem` derivation**

Required fields:
- `kind`
- `source`
- `required`
- `status`
- `purpose`
- `error`

Required derivation rules:
- uploaded source documents and images become required evidence when the prompt depends on them.
- current page is required evidence for continue and transform flows.
- external URLs are required evidence when the prompt semantically anchors to them.
- web search is required when the task requires external freshness or missing facts.

- [ ] **Step 3: Implement the hard gate before any user-visible planning**

Required runtime invariant:
- if any required evidence item is not `success`, the runtime may emit `step_*` and `blocked`, but may not emit `await_input` for `brief` or `blueprint` and may not emit `draft_patch`.

- [ ] **Step 4: Persist evidence state into session snapshots**

Required session fields:
- evidence summary
- failed evidence items
- current block resolution choices

- [ ] **Step 5: Run verification**

Run:
```bash
python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/models/evidence.py agent-service/app/orchestrator/tools/evidence.py agent-service/app/schemas/request.py agent-service/app/orchestrator/engine.py agent-service/app/models/session.py agent-service/app/main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py apps/client/src/ee/ai/services/ai-intent.test.ts
git commit -m "feat(ai-creator): enforce evidence-first runtime gating"
```

## Chunk 5: Blueprint Delta Policy and Document Tree State

### Task 5: Codify what may auto-patch after blueprint confirmation

**Files:**
- Modify: `agent-service/app/models/blueprint.py`
- Modify: `agent-service/app/models/session.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/orchestrator/tools/create_blueprint.py`
- Modify: `agent-service/app/orchestrator/tools/user_interaction.py`
- Test: `agent-service/tests/orchestrator/test_create_blueprint.py`
- Test: `agent-service/tests/orchestrator/test_e2e_level3.py`
- Test: `agent-service/tests/test_protocol_schemas.py`

- [ ] **Step 1: Write failing tests for blueprint delta policy**

Required assertions:
- these deltas may auto-patch without reopening blueprint confirmation:
  - `must_cover` updates
  - `evidence_refs` reassignment
  - single-section budget changes within `+/-15%` of that section's confirmed budget
  - visual prompt wording changes that do not change image strategy
- these deltas must reopen blueprint confirmation:
  - adding or removing sections
  - reordering sections
  - changing the title
  - changing total word budget by more than `10%`
  - changing image strategy

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_protocol_schemas.py -q
```

Expected: FAIL because the policy is not yet explicit.

- [ ] **Step 2: Implement the blueprint delta classifier**

Required behavior:
- the classifier returns `auto_patch` or `reconfirm_blueprint`.
- when reconfirmation is required, the session snapshot stores the pending patched blueprint for user review.
- when auto-patching is allowed, the session audit trail records what changed.

- [ ] **Step 3: Run verification**

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_protocol_schemas.py -q
```

Expected: PASS.

### Task 6: Introduce `DocumentTree` as the primary draft state

**Files:**
- Create: `agent-service/app/models/document_tree.py`
- Modify: `agent-service/app/models/session.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/orchestrator/tools/write_tools.py`
- Modify: `agent-service/app/workers/section_writer.py`
- Modify: `agent-service/app/orchestrator/tools/finalize.py`
- Modify: `apps/client/src/ee/ai/types/agent.types.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- Test: `agent-service/tests/orchestrator/test_write_tools.py`
- Test: `agent-service/tests/workers/test_section_writer.py`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **Step 4: Write failing tests for document-tree patching**

Required assertions:
- each written section updates a stable tree node, not only merged markdown.
- `draft_patch` includes section node identity and content.
- finalize still emits a merged markdown document derived from the canonical tree.

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/workers/test_section_writer.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts
```

Expected: FAIL because draft state is still too string-centric.

- [ ] **Step 5: Implement `DocumentNode` and `DocumentTree`**

Required node fields:
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

- [ ] **Step 6: Switch sequential writing to tree-node updates**

Required behavior:
- sequential writing remains the default.
- each section writes into its own node.
- each patch updates `draft_markdown` plus normalized tree nodes.
- write-time and review-time both enforce the same `+/-10%` section budget tolerance.

- [ ] **Step 7: Run verification**

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_e2e_level3.py -q
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add agent-service/app/models/blueprint.py agent-service/app/models/session.py agent-service/app/orchestrator/engine.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/orchestrator/tools/user_interaction.py agent-service/app/models/document_tree.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/workers/section_writer.py agent-service/app/orchestrator/tools/finalize.py apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/hooks/use-ai-create-session.ts agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_protocol_schemas.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/workers/test_section_writer.py apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat(ai-creator): codify blueprint deltas and document tree state"
```

---

## Chunk 6: Durable Session Persistence

### Task 7: Replace the temporary in-memory session store with PostgreSQL plus Redis persistence

**Files:**
- Modify: `agent-service/pyproject.toml`
- Modify: `agent-service/app/config.py`
- Create: `agent-service/app/orchestrator/session_repository.py`
- Create: `agent-service/app/orchestrator/persistence/postgres_session_store.py`
- Create: `agent-service/app/orchestrator/persistence/redis_runtime_store.py`
- Modify: `agent-service/app/orchestrator/session_store.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/main.py`
- Test: `agent-service/tests/test_main.py`
- Test: `agent-service/tests/test_protocol_schemas.py`
- Create: `agent-service/tests/test_session_repository.py`

- [ ] **Step 1: Write failing tests for durable session persistence**

Required assertions:
- canonical session snapshots survive process restart when persisted.
- review decisions, blueprint confirmation state, and document tree state survive snapshot reload.
- Redis-backed hot state preserves cancellation and resume semantics during an active run.
- development and test may still opt into an explicit `memory` backend, but production defaults do not silently fall back.

Run:
```bash
python -m pytest agent-service/tests/test_main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_session_repository.py -q
```

Expected: FAIL because the store is still in-memory only.

- [ ] **Step 2: Add repository abstractions and configuration**

Required behavior:
- `session_repository.py` defines the canonical interface for snapshot read/write and audit append.
- config supports `memory` and `postgres_redis` backends.
- the production-target backend stores canonical session snapshots and audit history in PostgreSQL.
- Redis stores active run state, locks, cancellation flags, and event fanout metadata.

- [ ] **Step 3: Migrate the runtime to repository-backed session persistence**

Required behavior:
- engine state updates write through the repository.
- `GET /agent/session/:session_id` reads from the repository, not process memory.
- the temporary in-memory implementation remains test-only and explicit.

- [ ] **Step 4: Run verification**

Run:
```bash
python -m pytest agent-service/tests/test_main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_session_repository.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/pyproject.toml agent-service/app/config.py agent-service/app/orchestrator/session_repository.py agent-service/app/orchestrator/persistence/postgres_session_store.py agent-service/app/orchestrator/persistence/redis_runtime_store.py agent-service/app/orchestrator/session_store.py agent-service/app/orchestrator/engine.py agent-service/app/main.py agent-service/tests/test_main.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_session_repository.py
git commit -m "feat(ai-creator): add durable postgres and redis session persistence"
```

---

## Chunk 7: Writing Deepening, Review/Fix Loop, and Visual Blocking

### Task 8: Make writing recover locally and review reopen deterministically

**Files:**
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/app/workers/section_writer.py`
- Modify: `agent-service/app/workers/evaluator.py`
- Modify: `agent-service/app/orchestrator/tools/fix_tools.py`
- Modify: `agent-service/app/orchestrator/tools/create_blueprint.py`
- Modify: `agent-service/app/workers/visual_planner.py`
- Test: `agent-service/tests/orchestrator/test_e2e_review.py`
- Test: `agent-service/tests/orchestrator/test_e2e_level3.py`
- Test: `agent-service/tests/workers/test_evaluator.py`
- Test: `agent-service/tests/orchestrator/test_create_blueprint.py`

- [ ] **Step 1: Write failing tests for local deepening and deterministic re-review**

Required assertions:
- section-level retry and deepening happens before whole-run failure.
- fix rewrites only selected or affected sections.
- visual generation failure creates `blocked(kind="visual")` or `ReviewIssue(category="visual")`.
- finalize is blocked while structure, length, asset, or visual blockers remain.

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_create_blueprint.py -q
```

Expected: FAIL because local-recovery and full re-review are still incomplete.

- [ ] **Step 2: Add section execution states and local recovery**

Required section states:
- `planned`
- `researching`
- `writing`
- `revising`
- `done`
- `blocked`

Required behavior:
- on budget or content failure, retry the current section first.
- on evidence insufficiency, run local deepening before escalating.
- already completed sections are preserved.

- [ ] **Step 3: Tighten the review and fix loop**

Required behavior:
- auto-fix always runs first.
- only selected non-auto-fix issues are rewritten.
- after fix, rerun deterministic checks plus full blocking review.
- only explicitly skippable issue classes may be skipped, and every skip is audited.

- [ ] **Step 4: Enforce visual planning and blocking**

Required behavior:
- `generate_new` and `mixed` must yield an executable visual plan.
- missing required image generation must prevent silent completion.

- [ ] **Step 5: Run verification**

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/orchestrator/engine.py agent-service/app/workers/section_writer.py agent-service/app/workers/evaluator.py agent-service/app/orchestrator/tools/fix_tools.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/workers/visual_planner.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_create_blueprint.py
git commit -m "feat(ai-creator): add local deepening and deterministic review loop"
```

---

## Chunk 8: Workbench UI Completion and Acceptance

### Task 9: Complete the workbench interaction model and run browser acceptance checks

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- Test: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

- [ ] **Step 1: Write failing UI tests or contract checks for blocked and document-tree rendering**

Required assertions:
- blocked state renders a recoverable action card, not a fatal error.
- document tree reflects section patch state.
- `brief`, `blueprint`, and `review` remain the only user-facing hard stop cards.

- [ ] **Step 2: Implement the blocked card and document tree panel**

Required UI behavior:
- left column: document tree and section status
- center column: live draft
- right column: evidence, brief, blueprint, and review cards
- chat remains an activity log, not the sole control surface

- [ ] **Step 3: Run browser-level manual acceptance**

Minimum scenarios:
- upload document -> brief -> blueprint -> write -> review -> fix -> finalize
- source read failure -> `blocked(evidence)`
- image generation failure -> `blocked(visual)` or review visual blocker
- refresh during `awaiting_input` -> state restored from snapshot

- [ ] **Step 4: Run final verification**

Run:
```bash
python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/test_session_repository.py -q
pnpm --filter ./apps/client exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec tsc --noEmit --pretty false
pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand
pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/services/ai-intent.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.reducer.test.ts apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat(ai-creator): complete workbench interaction model"
```

---

## Non-Negotiable Acceptance Criteria

- No user-visible `brief`, `blueprint`, or `draft` output may appear before required evidence succeeds.
- `blocked` remains resumable and is never routed through the generic error path.
- Section writing stays sequential by default and preserves coherence over speed.
- Review and fix reopen deterministically until blockers are resolved or explicitly skipped where allowed.
- Finalize derives from the canonical document tree and fails closed on structure mismatch.
- Browser refresh does not lose the active session state.
- Public contract is centered on `session_id` and typed resume commands.
- Confirmed blueprint changes follow the explicit auto-patch versus reconfirm policy.
- Canonical session state survives process restart through PostgreSQL and Redis persistence.

## Execution Rule From This Point Forward

- Treat this file as the only implementation plan of record for the rebuild.
- Any new implementation work must map to one of the tasks above before code changes begin.
- If the design changes materially, update this plan first, then continue implementation.
- `Chunk 2` is the next executable chunk. Do not start `Chunk 3` or later work until `Chunk 2` is complete and verified.
