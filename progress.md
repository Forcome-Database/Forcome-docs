# Progress Log

## Session: 2026-03-14

### Phase 1: Requirements & Discovery
- **Status:** complete
- **Started:** 2026-03-14
- Actions taken:
  - Audited spec, phase docs, frontend, backend, and orchestrator flow.
  - Confirmed major contract breaks around file uploads, resume SSE, visual planning, and review fixes.
  - Collected validation baseline from pytest and TypeScript checks.
- Files created/modified:
  - task_plan.md (created)
  - findings.md (created)
  - progress.md (created)

### Phase 2: Protocol & Model Alignment
- **Status:** complete
- Actions taken:
  - Diffed dirty backend files and treated them as the working baseline.
  - Converted agent frontend run transport to `FormData` with `files[]`.
  - Updated agent gateway to parse multipart uploads and forward `content_b64` payloads.
  - Changed `/agent/resume` proxy path to stream SSE instead of returning JSON.
  - Aligned frontend interrupt payload types to typed `brief` / `blueprint` / `review` wrappers.
- Files created/modified:
  - apps/client/src/ee/ai/types/agent.types.ts
  - apps/client/src/ee/ai/services/agent-service.ts
  - apps/client/src/ee/ai/hooks/use-ai-create-session.ts
  - apps/client/src/ee/ai/components/ai-creator/ai-create-session.messages.ts
  - apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx
  - apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx
  - apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts
  - apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts

### Phase 3: Main Flow Implementation
- **Status:** complete
- Actions taken:
  - Changed Python `/agent/resume` to reopen an SSE stream and end streams at `await_input`.
  - Wrapped `await_input.data` in typed payloads and attached brief asset summaries.
  - Upgraded research trigger from “no files” to “evidence insufficient”, with multi-source enrichment.
  - Rewrote `create_blueprint.py` to emit spec fields, parse visuals, integrate `VisualPlanner`, and add ai-image fallback.
  - Added generated image URLs into section context, standardized image events to `alt`, and tracked truthful asset usage via hidden markers.
  - Stripped asset markers in finalize and added deterministic visual coverage checks in evaluator.
  - Emitted `fix_applied` SSE events during selective repairs.
- Files created/modified:
  - agent-service/app/main.py
  - agent-service/app/orchestrator/engine.py
  - agent-service/app/orchestrator/tools/create_blueprint.py
  - agent-service/app/orchestrator/tools/finalize.py
  - agent-service/app/orchestrator/tools/fix_tools.py
  - agent-service/app/orchestrator/tools/write_tools.py
  - agent-service/app/schemas/response.py
  - agent-service/app/workers/section_writer.py
  - agent-service/app/workers/evaluator.py

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Python orchestrator/worker suite | `python -m pytest agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py -q` | Existing backend tests pass | 76 passed | pass |
| Client typecheck | `pnpm --filter ./apps/client exec tsc --noEmit --pretty false` | Pass | Pass | pass |
| Server typecheck | `pnpm --filter ./apps/server exec tsc --noEmit --pretty false` | Pass | Fails in `agent-gateway.controller.spec.ts` typing | fail |
| Updated client typecheck | `pnpm --filter ./apps/client exec tsc --noEmit --pretty false` | Pass after contract changes | Pass | pass |
| Updated server typecheck | `pnpm --filter ./apps/server exec tsc --noEmit --pretty false` | Pass after gateway changes | Pass | pass |
| Python regression suite | `python -m pytest agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py -q` | Pass after orchestrator changes | 76 passed | pass |
| Blueprint/write tool tests | `python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_write_tools.py -q` | Pass | 45 passed | pass |
| Gateway controller spec | `pnpm --filter ./apps/server exec jest src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts --runInBand` | Pass | Pass | pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-03-14 | Missing planning skill catchup script at expected path | 1 | Switched to local templates and manual session tracking |

## Session: 2026-03-18

### Phase 4: Testing & Verification
- **Status:** in_progress
- Actions taken:
  - Re-read `task_plan.md`, `findings.md`, `progress.md`, and current `git diff --stat` to recover prior session state.
  - Confirmed the remaining verification target is the review/fix/re-review loop plus missing-section completion gating.
  - Prepared to run a narrow regression slice before making any additional code edits.
  - Ran targeted protocol/resume/review-loop tests and confirmed they pass on the resumed worktree.
  - Found one remaining failing regression in `test_fix_selected_auto_fix_applied`, traced it to `fix_selected_issues()` incorrectly gating auto-fixes behind `selected_issue_ids`, then repaired that logic.
  - Verified the repaired Python flow with the affected orchestrator/worker suites and confirmed the client-side runner tests pass when executed with `tsx --test`.

## Additional Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Narrow resumed regression | `python -m pytest agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q` | Pass | 12 passed | pass |
| Affected Python suites after final fix | `python -m pytest agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_fix_tools.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_protocol_schemas.py agent-service/tests/test_main.py agent-service/tests/orchestrator/test_e2e_level3.py -q` | Pass | 138 passed | pass |
| Client runner node:test suite | `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts` | Pass | 9 passed | pass |
| Client intent node:test suite | `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-intent.test.ts` | Pass | 5 passed | pass |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 4: Testing & Verification |
| Where am I going? | Final regression sweep, touched-file review, and delivery |
| What's the goal? | Implement AI Creator v2 spec-aligned end-to-end flow |
| What have I learned? | Upload/resume/visual/review contracts were the main broken chains; they now have matching frontend/backend contracts |
| What have I done? | Implemented the first end-to-end alignment pass and rerun key tests |

## Session: 2026-03-19 MinerU-First Planning

### Phase: Discovery & Planning
- **Status:** complete
- Actions taken:
  - Verified from official MinerU documentation that the cloud API supports `pdf/doc/docx/ppt/pptx/png/jpg/jpeg/html`.
  - Confirmed MinerU is better aligned with the current PDF/source-image preservation problem, while Docling still covers unsupported formats such as `xlsx`.
  - Revalidated the local parser gap using the real `采购退货单sop.pdf` fixture: the Docling path leaves `<!-- image -->` placeholders but returns `image_count=0`.
  - Wrote a dedicated implementation plan for a MinerU-first / Docling-fallback rollout.
- Files created/modified:
  - docs/superpowers/plans/2026-03-19-ai-creator-mineru-first-parsing.md
  - findings.md
  - progress.md
  - task_plan.md

## Upcoming Validation Targets
| Test | Input | Expected | Status |
|------|-------|----------|--------|
| MinerU client unit tests | `python -m pytest agent-service/tests/tools/test_mineru_client.py -q` | Config, upload, polling, and ZIP download behavior verified | pending |
| MinerU parser unit tests | `python -m pytest agent-service/tests/workers/test_mineru_parser.py -q` | ZIP output converts to text + image payloads | pending |
| Parser routing tests | `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q` | Supported files route to MinerU first, fallback to Docling on failure | pending |

## Session: 2026-03-19 MinerU-First Implementation

### Phase: MinerU Client & Parser Routing
- **Status:** in_progress
- Actions taken:
  - Added a MinerU API client with env-driven config, upload URL request orchestration, polling, and ZIP download handling.
  - Added a MinerU ZIP parser that preserves text, image payloads, basic heading structure, and block order metadata.
  - Switched `asset_parser.parse_document()` to prefer MinerU for supported formats and fall back to Docling on failure.
  - Added parser routing tests covering MinerU-first PDF handling, Docling fallback, and XLSX staying on Docling.
  - Added MinerU env placeholders to `.env.example`.
- Files created/modified:
  - agent-service/app/tools/mineru_client.py
  - agent-service/app/workers/mineru_parser.py
  - agent-service/app/workers/asset_parser.py
  - agent-service/app/models/source_assets.py
  - agent-service/tests/test_tools/test_mineru_client.py
  - agent-service/tests/workers/test_mineru_parser.py
  - agent-service/tests/orchestrator/test_parse_assets_mineru.py
  - .env.example

## Additional Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| MinerU client + parser + asset parser + parse_assets | `python -m pytest agent-service/tests/test_tools/test_mineru_client.py agent-service/tests/workers/test_mineru_parser.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_parallel.py agent-service/tests/orchestrator/test_parse_assets_mineru.py -q` | Pass | 67 passed | pass |
| Engine/L2 regression after MinerU-first routing | `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q` | Pass | 28 passed | pass |

## Current Blockers
| Blocker | Evidence | Next Step |
|---------|----------|-----------|
| MinerU cloud auth could not be validated with the provided token | Real requests to `GET https://mineru.net/api/v4/quota` and `POST https://mineru.net/api/v4/file-urls/batch` returned `401 user authenticate failed` | Confirm the correct API token / tenant binding, then rerun real API smoke validation before relying on MinerU in production |
