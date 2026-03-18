# Task Plan: AI Creator v2 Spec Alignment Implementation

## Goal
Implement the AI Creator v2 spec-alignment plan end to end so the main flow closes correctly across upload, research, brief, blueprint, sequential section writing, review, targeted fixes, and finalization.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Protocol & Model Alignment
- [x] Align public interfaces and event contracts
- [x] Align backend/frontend types and models
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Main Flow Implementation
- [x] Implement upload, resume, research, blueprint, writing, review, and fix flow changes
- [x] Preserve current dirty worktree changes without reverting user work
- [x] Test incrementally
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Verify all requirements met
- [x] Document test results in progress.md
- [x] Fix any issues found
- **Status:** complete

### Phase 5: Delivery
- [x] Review touched files
- [x] Ensure deliverables are complete
- [ ] Deliver outcome and residual risks
- **Status:** in_progress

## Key Questions
1. Which existing dirty-file changes already implement parts of the alignment plan?
2. Which contract changes can be landed without forcing a full orchestrator rewrite?
3. Which tests need to be added or updated to guard the repaired main flow?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use spec + phase0~5 as the implementation baseline | User explicitly asked to align to requirements/spec, not preserve current behavior |
| Treat current imperative engine as a transitional orchestrator | Large enough to deliver flow alignment without a full ReAct rewrite in this round |
| Default to sequential section writing | Restores coherence and simplifies deterministic review gating |
| Block completion when planned image generation fails | Matches requested quality bar and avoids silent degraded output |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| planning-with-files session-catchup script missing from expected path | 1 | Used local skill templates directly and continued |
| Direct Jest invocation against `apps/client/src/ee/ai/services/ai-create-runner.test.ts` failed with ESM parsing error | 1 | Verified the file with `pnpm exec tsx --test ...`, which matches its `node:test` format |
