# Findings & Decisions

## Requirements
- Align implementation to `docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md` and phase0~5 plans.
- Close the full chain: upload/material collection -> research -> brief -> blueprint -> sequential section writing -> review -> targeted fixes -> finalize.
- Restore spec fields and contracts across Python models, frontend TS types, and SSE events.
- Fix upload propagation, resume streaming, visual planning, image generation, truthful asset coverage, and review fix continuation.
- Preserve existing dirty user/work-in-progress changes; do not revert unrelated modifications.

## Research Findings
- Agent-mode frontend currently posts JSON without files, while the legacy creator flow already uses `FormData`; the new agent flow can reuse that transport shape.
- UI shells for Smart Brief, Blueprint, and Review already exist, but the upstream event payloads and resume protocol do not fully satisfy them.
- Backend tests currently cover internal orchestrator behavior more than frontend/backend contract continuity, leaving broken resume/upload/image chains undetected.
- The existing dirty backend work already covered part of L2/L3 orchestration, so implementation could extend that baseline instead of replacing it.
- Converting `/agent/resume` to SSE required changing both Python endpoint lifecycle and Nest proxy behavior; fixing only one side would still leave the chain broken.
- Truthful asset usage can be recovered without a larger parser by inserting hidden `<!--asset:id-->` markers during section writing and stripping them at finalize time.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Reuse multipart upload path for `/api/agent/run` | Minimizes frontend churn and matches required file transfer semantics |
| Keep `parse_assets_tool()` internal JSON shape unchanged | Localizes change to the Nest gateway and frontend transport |
| Emit typed `await_input.data` payloads | Removes frontend phase-based guessing and matches the requested public contract |
| Use inline hidden asset markers for truthful reuse tracking | Gives evaluator deterministic evidence without exposing markers to final users |
| End SSE streams on `await_input` and reopen on `/resume` | Matches interrupt/resume semantics and prevents hanging interactive runs |
| Add ai-image fallback when `image_strategy` requires generation but blueprint lacks `ai_image` | Prevents requested image generation from never triggering |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Session-catchup script path in skill instructions does not exist on this machine | Used local template files directly and continued with explicit tracking files |
| Relevant backend files are already dirty | Treat current file contents as working baseline and diff before edits |
| `create_blueprint.py` contained mixed partial edits and encoding noise | Rewrote the tool file cleanly around current required behavior |

## Session Recovery Notes
- Resumed on 2026-03-18 with the working tree still dirty from the prior implementation pass.
- Remaining verification focus is narrower than the original plan: confirm the repair loop actually re-runs review and confirm missing sections now hard-block finalize without breaking existing tests.
- Current risk is not transport/protocol drift anymore; it is state-machine correctness under fix/re-review and finalize gating.

## Additional Verification Findings
- `fix_selected_issues()` had one remaining contract mismatch: it only auto-fixed issues included in `selected_issue_ids`, while the review/fix flow and tests require deterministic auto-fixes to run regardless of user selection.
- The fix was localized to `agent-service/app/orchestrator/tools/fix_tools.py`: auto-fixable issues are now always passed through `apply_auto_fixes()`, while manual targeted fixes remain scoped to the user's selected issue ids.
- `apps/client/src/ee/ai/services/ai-create-runner.test.ts` is a `node:test` file, not a Jest test. Direct `jest` invocation fails on ESM/TS parsing, but the correct repo-local execution path `pnpm exec tsx --test ...` passes.

## Resources
- `/e:/test/Docmost/docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase1-orchestrator.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`

## Visual/Browser Findings
- None yet.
