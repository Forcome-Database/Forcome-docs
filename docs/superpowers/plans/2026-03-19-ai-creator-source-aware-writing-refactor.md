# AI Creator Source-Aware Writing Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate repeated full-section rewrites and token waste, preserve source-document images as first-class reusable assets, and make image/review state deterministic across the agent-service, gateway, and workbench UI.

**Architecture:** Use a middleware-first, model-assisted pipeline. Uploaded files are normalized into a structured parse result with text assets, image assets, provenance, and stable reusable URLs. The writer produces one initial draft per section, optionally applies one targeted transform to that same draft, and only materializes visuals after the text is stable. Blueprint review becomes the control point for image policy and source-figure approval, while runtime events expose extraction, reuse, degradation, and generation decisions.

**Tech Stack:** FastAPI, Pydantic models, PydanticAI/OpenAI-compatible streaming, NestJS gateway, React, TypeScript, pytest, `node:test`, `tsx`, browser acceptance scripts

**Working Tree:** Execute this plan from `E:\test\Docmost\.worktrees\ai-creator-workbench`. All file paths below are relative to that worktree root.

---

## Scope and Success Criteria

- Default Level 3 writing flow writes each section once and performs at most one targeted revise pass.
- Parser-extracted images from uploaded PDFs or other supported files become `AssetItem(type="image")` entries with source provenance and reusable Docmost URLs.
- Blueprint review exposes explicit image policy and per-section source-image candidates instead of silently relying on weak keyword overlap.
- Generated images are created only after text stabilizes and only when policy allows generation.
- Review/evaluator logic blocks finalize when a required source figure or required generated figure is missing.
- Workbench UI shows source-image extraction results, visual decisions, and degraded states.
- Regression, typecheck, and browser acceptance cover source-image reuse, prefer-reuse fallback, and token-control behavior.

## Guardrails

- Keep current session and API payloads backward-compatible while introducing richer optional fields.
- Normalize legacy image strategies (`reuse_source`, `mixed`, `generate_new`, `none`) into one canonical internal enum instead of breaking older snapshots.
- Do not introduce new hidden background retry loops.
- Do not generate or upload duplicate images for the same source asset or the same section prompt.
- Prefer additive schema changes and focused helper files over large rewrites in already-busy modules.

## File Structure Overview

### New files

- `agent-service/app/models/source_assets.py`
- `agent-service/app/tools/source_image_store.py`
- `agent-service/app/workers/section_revision.py`
- `agent-service/tests/workers/test_source_image_store.py`
- `apps/client/src/ee/ai/types/source-assets.types.ts`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.tsx`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx`
- `agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

### Modified files

- `agent-service/app/models/asset_map.py`
- `agent-service/app/models/blueprint.py`
- `agent-service/app/models/brief.py`
- `agent-service/app/schemas/response.py`
- `agent-service/app/workers/asset_parser.py`
- `agent-service/app/orchestrator/tools/parse_assets.py`
- `agent-service/app/tools/docling_parser.py`
- `agent-service/app/tools/docmost_api.py`
- `agent-service/app/workers/visual_planner.py`
- `agent-service/app/orchestrator/tools/create_brief.py`
- `agent-service/app/orchestrator/tools/create_blueprint.py`
- `agent-service/app/workers/section_writer.py`
- `agent-service/app/orchestrator/tools/write_tools.py`
- `agent-service/app/orchestrator/tools/rewrite_section.py`
- `agent-service/app/workers/evaluator.py`
- `agent-service/app/agent/events.py`
- `agent-service/app/runtime_logging.py`
- `agent-service/app/main.py`
- `apps/client/src/ee/ai/types/brief.types.ts`
- `apps/client/src/ee/ai/types/blueprint.types.ts`
- `apps/client/src/ee/ai/types/agent.types.ts`
- `apps/client/src/ee/ai/services/agent-service.ts`
- `apps/client/src/ee/ai/services/ai-create-runner.ts`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- `apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx`

---

## Chunk 1: Source Asset Contracts and Ingestion

### Task 1: Preserve parser-extracted images as first-class assets

**Files:**
- Create: `agent-service/app/models/source_assets.py`
- Modify: `agent-service/app/models/asset_map.py`
- Modify: `agent-service/app/workers/asset_parser.py`
- Modify: `agent-service/app/orchestrator/tools/parse_assets.py`
- Test: `agent-service/tests/workers/test_asset_parser.py`
- Test: `agent-service/tests/orchestrator/test_parse_assets.py`

- [ ] **Step 1: Write the failing tests**
Add cases proving that parser-returned `images` become `AssetItem(type="image")` with `content_hash`, `source_page`, `source_heading`, `caption`, and `origin="uploaded_source"`.

- [ ] **Step 2: Run tests to verify failure**
Run: `python -m pytest agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py -q`
Expected: FAIL because `asset_parser.py` currently discards parser-returned images.

- [ ] **Step 3: Implement the parse-result contract**
Create `source_assets.py` with `SourceLocation`, `SourceImageAsset`, and `DocumentParseResult`. Extend `AssetItem` with optional provenance fields instead of breaking existing JSON.

- [ ] **Step 4: Wire parser output through ingestion**
Update `parse_document()` to read both `result["text"]` and `result["images"]`, then update `parse_assets_impl()` so it no longer depends on inbound `file_info["images"]`.

- [ ] **Step 5: Re-run tests**
Run: `python -m pytest agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/models/source_assets.py agent-service/app/models/asset_map.py agent-service/app/workers/asset_parser.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py
git commit -m "feat(agent-service): preserve extracted source images in asset ingestion"
```

### Task 2: Add source-image dedupe and rehosting

**Files:**
- Create: `agent-service/app/tools/source_image_store.py`
- Modify: `agent-service/app/orchestrator/tools/parse_assets.py`
- Modify: `agent-service/app/tools/docmost_api.py`
- Test: `agent-service/tests/workers/test_source_image_store.py`
- Test: `agent-service/tests/orchestrator/test_parse_assets_parallel.py`

- [ ] **Step 1: Write the failing tests**
Add cases proving the same extracted image uploaded twice for the same page reuses the same stored URL, and parallel parsing does not duplicate uploads.

- [ ] **Step 2: Run tests to verify failure**
Run: `python -m pytest agent-service/tests/workers/test_source_image_store.py agent-service/tests/orchestrator/test_parse_assets_parallel.py -q`
Expected: FAIL because no content-hash cache exists yet.

- [ ] **Step 3: Implement hash-based source-image storage**
Add `compute_image_hash()` and `ensure_source_image_uploaded()` in `source_image_store.py`, keyed by `page_id + content_hash`, while keeping actual upload IO in `docmost_api.py`.

- [ ] **Step 4: Route parse-assets through the store**
Update `parse_assets_impl()` to upload extracted images through the new store and write the stable URL and hash back onto each `AssetItem`.

- [ ] **Step 5: Re-run tests**
Run: `python -m pytest agent-service/tests/workers/test_source_image_store.py agent-service/tests/orchestrator/test_parse_assets_parallel.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/tools/source_image_store.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/tools/docmost_api.py agent-service/tests/workers/test_source_image_store.py agent-service/tests/orchestrator/test_parse_assets_parallel.py
git commit -m "feat(agent-service): dedupe and rehost extracted source images"
```

## Chunk 2: Blueprint Image Policy and Candidate Binding

### Task 3: Canonicalize image policy and upgrade visual planning

**Files:**
- Modify: `agent-service/app/models/brief.py`
- Modify: `agent-service/app/models/blueprint.py`
- Modify: `agent-service/app/orchestrator/tools/create_brief.py`
- Modify: `agent-service/app/orchestrator/tools/create_blueprint.py`
- Modify: `agent-service/app/workers/visual_planner.py`
- Test: `agent-service/tests/orchestrator/test_create_brief.py`
- Test: `agent-service/tests/orchestrator/test_create_blueprint.py`
- Test: `agent-service/tests/workers/test_visual_planner.py`

- [ ] **Step 1: Write the failing tests**
Add coverage for canonical policies:
`reuse_source_only`, `prefer_source_then_generate`, `generate_new_only`, `none`.
Also prove blueprint returns ranked `visual_candidates` per section.

- [ ] **Step 2: Run tests to verify failure**
Run: `python -m pytest agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/workers/test_visual_planner.py -q`
Expected: FAIL because the planner only does keyword overlap and models do not expose candidate lists.

- [ ] **Step 3: Implement canonical policy handling**
Normalize legacy policy names at model-validation boundaries so old sessions keep working.

- [ ] **Step 4: Replace single-winner planning with scored candidates**
Score candidates with caption similarity, image summary similarity, nearby heading match, page-context keywords, and `must_cover` overlap. Persist both candidate list and selected visual decision in blueprint models.

- [ ] **Step 5: Re-run tests**
Run: `python -m pytest agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/workers/test_visual_planner.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/models/brief.py agent-service/app/models/blueprint.py agent-service/app/orchestrator/tools/create_brief.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/workers/visual_planner.py agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/workers/test_visual_planner.py
git commit -m "feat(planning): add canonical image policy and scored source-image candidates"
```

### Task 4: Expose source-image candidates in the workbench

**Files:**
- Create: `apps/client/src/ee/ai/types/source-assets.types.ts`
- Create: `apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx`
- Modify: `apps/client/src/ee/ai/types/brief.types.ts`
- Modify: `apps/client/src/ee/ai/types/blueprint.types.ts`
- Modify: `apps/client/src/ee/ai/types/agent.types.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- Test: `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`

- [ ] **Step 1: Write the failing UI tests**
Add tests proving the blueprint modal shows candidate images with caption, source file, and page hint, and that users can switch a section from generated-image mode to a specific source image.

- [ ] **Step 2: Run tests to verify failure**
Run: `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
Expected: FAIL because the UI does not yet know about candidate lists or canonical policies.

- [ ] **Step 3: Add focused UI types and picker component**
Keep `source-assets.types.ts` focused on candidate metadata and use `SourceImageCandidates.tsx` inside `BlueprintModal.tsx` instead of embedding all candidate rendering logic in the modal.

- [ ] **Step 4: Wire modal confirmation payloads**
Ensure blueprint confirmation sends canonical image policy, selected source-image candidate IDs per section, and explicit `generate instead` overrides where applicable.

- [ ] **Step 5: Re-run tests and typecheck**
Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/types/source-assets.types.ts apps/client/src/ee/ai/types/brief.types.ts apps/client/src/ee/ai/types/blueprint.types.ts apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx
git commit -m "feat(client): add blueprint source-image review and canonical image policy UI"
```

## Chunk 3: Writer Lifecycle, Token Control, and Image Materialization

### Task 5: Collapse double retry into one initial draft plus one targeted revision

**Files:**
- Create: `agent-service/app/workers/section_revision.py`
- Modify: `agent-service/app/workers/section_writer.py`
- Modify: `agent-service/app/orchestrator/tools/write_tools.py`
- Modify: `agent-service/app/orchestrator/tools/rewrite_section.py`
- Test: `agent-service/tests/workers/test_section_writer.py`
- Test: `agent-service/tests/orchestrator/test_write_tools.py`
- Test: `agent-service/tests/orchestrator/test_rewrite_section.py`

- [ ] **Step 1: Write the failing tests**
Add tests proving the normal path calls one section draft generation, and over-budget or under-budget sections use one targeted transform on the previous draft instead of a fresh full rewrite.

- [ ] **Step 2: Run tests to verify failure**
Run: `python -m pytest agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py -q`
Expected: FAIL because current logic still composes outer and inner retries.

- [ ] **Step 3: Implement the new write lifecycle**
Split responsibilities so `section_writer.py` owns initial draft generation and streaming, `section_revision.py` owns `condense` / `expand` / `restructure`, and `write_tools.py` decides whether one targeted revision is needed. Keep all length-threshold logic in one helper.

- [ ] **Step 4: Re-run tests**
Run: `python -m pytest agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/section_revision.py agent-service/app/workers/section_writer.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/orchestrator/tools/rewrite_section.py agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py
git commit -m "refactor(writer): replace repeated full rewrites with targeted section revision"
```

### Task 6: Materialize visuals only after text is stable

**Files:**
- Modify: `agent-service/app/workers/section_writer.py`
- Modify: `agent-service/app/orchestrator/tools/write_tools.py`
- Modify: `agent-service/app/tools/source_image_store.py`
- Modify: `agent-service/app/tools/docmost_api.py`
- Test: `agent-service/tests/workers/test_generate_section_visuals.py`
- Test: `agent-service/tests/orchestrator/test_e2e_level3.py`

- [ ] **Step 1: Write the failing tests**
Add tests proving `generate_section_visuals()` is not called before text acceptance, selecting a source image does not trigger AI generation, and targeted revisions do not duplicate uploads.

- [ ] **Step 2: Run tests to verify failure**
Run: `python -m pytest agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/orchestrator/test_e2e_level3.py -q`
Expected: FAIL because visuals are currently generated too early and are tied to write retries.

- [ ] **Step 3: Implement two-phase visual materialization**
Make `write_single_section()` follow: initial text draft, optional targeted revise, choose approved visual decision, reuse approved source image or generate one new image exactly once, then emit final visual state.

- [ ] **Step 4: Re-run tests**
Run: `python -m pytest agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/orchestrator/test_e2e_level3.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/section_writer.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/tools/source_image_store.py agent-service/app/tools/docmost_api.py agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/orchestrator/test_e2e_level3.py
git commit -m "refactor(writer): delay visual materialization until text is stable"
```

## Chunk 4: Evaluation, Observability, and Degraded-State Surfacing

### Task 7: Make evaluator and review logic understand visual commitments

**Files:**
- Modify: `agent-service/app/workers/evaluator.py`
- Modify: `agent-service/app/orchestrator/tools/fix_tools.py`
- Modify: `agent-service/app/models/blueprint.py`
- Test: `agent-service/tests/workers/test_evaluator.py`
- Test: `agent-service/tests/orchestrator/test_e2e_review.py`

- [ ] **Step 1: Write the failing tests**
Add cases proving `reuse_source_only` blocks finalize if no approved source figure is inserted, and `prefer_source_then_generate` only downgrades to warning when the fallback is explicit and traceable.

- [ ] **Step 2: Run tests to verify failure**
Run: `python -m pytest agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_e2e_review.py -q`
Expected: FAIL because evaluator currently only checks broad visual blockers.

- [ ] **Step 3: Implement policy-aware evaluation**
Persist enough blueprint metadata to compare requested policy, approved source-image candidate ID, actual inserted figure evidence, and fallback reason if generation was used.

- [ ] **Step 4: Re-run tests**
Run: `python -m pytest agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_e2e_review.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/evaluator.py agent-service/app/orchestrator/tools/fix_tools.py agent-service/app/models/blueprint.py agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_e2e_review.py
git commit -m "feat(review): enforce approved visual policy during evaluation and fixes"
```

### Task 8: Surface write attempts, source-image status, and degraded states end to end

**Files:**
- Modify: `agent-service/app/agent/events.py`
- Modify: `agent-service/app/runtime_logging.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/schemas/response.py`
- Modify: `apps/client/src/ee/ai/services/agent-service.ts`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.ts`
- Modify: `apps/client/src/ee/ai/types/agent.types.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- Test: `agent-service/tests/test_event_logging.py`
- Test: `agent-service/tests/test_main.py`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- Test: `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`

- [ ] **Step 1: Write the failing tests**
Add coverage for per-section `write_attempts`, extracted/reused/generated/skipped image counts, degraded reasons, and client snapshot normalization.

- [ ] **Step 2: Run tests to verify failure**
Run:
- `python -m pytest agent-service/tests/test_event_logging.py agent-service/tests/test_main.py -q`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
Expected: FAIL because current events and snapshot types do not expose these details.

- [ ] **Step 3: Implement structured observability**
Emit structured events for source-image extraction, reuse, generated fallback, and section revision. Surface aggregated state through session snapshots so the UI can show badges and blocks without parsing raw logs.

- [ ] **Step 4: Re-run tests and typecheck**
Run:
- `python -m pytest agent-service/tests/test_event_logging.py agent-service/tests/test_main.py -q`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/events.py agent-service/app/runtime_logging.py agent-service/app/main.py agent-service/app/schemas/response.py apps/client/src/ee/ai/services/agent-service.ts apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx agent-service/tests/test_event_logging.py agent-service/tests/test_main.py apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx
git commit -m "feat(observability): expose visual lifecycle and write-attempt state end to end"
```

## Chunk 5: End-to-End Acceptance and Rollout

### Task 9: Extend browser acceptance to cover source-image reuse and fallback paths

**Files:**
- Create: `agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- Modify: `agent-service/tests/browser_ai_creator_smoke.py`
- Modify: `agent-service/tests/browser_ai_creator_agent_outline_e2e.py`
- Modify: `agent-service/tests/playwright_ai_creator_utils.py`

- [ ] **Step 1: Write or update browser scenarios**
Cover PDF upload with a reusable figure, `reuse_source_only` insertion, `prefer_source_then_generate` fallback, and no duplicate images after revise or resume.

- [ ] **Step 2: Run the browser suite and capture failures**
Run:
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
Expected: FAIL until the new UI and session-state behaviors are present.

- [ ] **Step 3: Fix the acceptance gaps only after lower-level tests are green**
Do not patch browser tests around broken behavior. Fix the underlying contract or UI behavior first.

- [ ] **Step 4: Re-run browser acceptance**
Run:
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- `python agent-service/tests/browser_ai_creator_insert_e2e.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py agent-service/tests/browser_ai_creator_smoke.py agent-service/tests/browser_ai_creator_agent_outline_e2e.py agent-service/tests/playwright_ai_creator_utils.py
git commit -m "test(browser): cover source-image reuse and fallback acceptance flows"
```

### Task 10: Run the full verification matrix and update docs

**Files:**
- Modify: `docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md`
- Modify: `docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md`
- Modify: `docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md`
- Modify: `docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`

- [ ] **Step 1: Update spec and phase docs**
Record canonical image policy names, middleware-first source-image ingestion, single-write plus targeted-revision lifecycle, post-text visual materialization, and policy-aware evaluation.

- [ ] **Step 2: Run the backend verification matrix**
Run:
`python -m pytest agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_parallel.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/workers/test_visual_planner.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_event_logging.py agent-service/tests/test_main.py -q`
Expected: PASS.

- [ ] **Step 3: Run the frontend verification matrix**
Run:
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`
- `pnpm --filter ./apps/server exec tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 4: Review worktree state and create the final integration commit**
Run:
- `git status --short --branch`
- `git add docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`
- `git commit -m "docs: align AI Creator spec and phase plans with source-aware writing refactor"`

- [ ] **Step 5: Prepare rollout notes**
Document any temporary backward-compat normalization, any file formats that still need PDF conversion, and any remaining cost/usage dashboard work deferred beyond this refactor.

## Deferred Follow-Up Work

- Add optional server-side conversion of `.docx` and `.pptx` to PDF before multimodal parsing when figure fidelity matters.
- Add semantic figure embeddings for better candidate retrieval across weakly labeled screenshots.
- Add workspace-level AI usage dashboards and per-run cost summaries similar to Coda-style governance.
- Add explicit user-facing `regenerate section` and `accept/reject revision` controls if the product moves further toward visible stepwise editing.
