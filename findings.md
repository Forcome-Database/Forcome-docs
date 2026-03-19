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

## Session: 2026-03-19 MinerU Parser Research

### Official documentation findings
- MinerU cloud API officially supports `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.png`, `.jpg`, `.jpeg`, and `.html`.
- The practical upload flow for local files is `POST /api/v4/file-urls/batch` -> upload to presigned URLs -> poll extract results -> download ZIP output.
- The API output includes richer parser artifacts than the current Docling path and is a better fit for preserving source images and layout blocks in AI Creator.
- MinerU does not clearly cover `xlsx/csv/markdown/xml/audio/video`, so it should not replace Docling outright.

### Local project findings
- Current Docling-based parsing already works well enough for `docx` image extraction but fails to materialize image assets for at least one real-world PDF fixture that still contains `<!-- image -->` placeholders in extracted markdown.
- AI Creator's planner/writer stack is already parser-agnostic above `AssetMap`; parser replacement can therefore be isolated to `parse_assets_tool()`, `parse_document()`, and source-image materialization helpers.
- The right architectural move is `MinerU-first / Docling-fallback`, not `MinerU-only`.

### Decisions
| Decision | Rationale |
|----------|-----------|
| Adopt MinerU as the preferred parser for MinerU-supported formats | Better alignment with current PDF/source-image preservation requirements |
| Keep Docling fallback for unsupported formats and MinerU failures | Preserves coverage and avoids hard API dependency regressions |
| Parse MinerU ZIP output into existing `DocumentParseResult` / `AssetMap` contracts | Minimizes upper-layer churn |
| Add deterministic low-value image filtering before planner consumption | Needed to keep useful SOP screenshots while dropping logos and page chrome |
| Prefer structure-preserving authoring over flatten-then-rewrite | MinerU carries heading/block/layout information that should directly inform planning and section writing |

### Implementation findings
- `asset_parser.parse_document()` is the right integration seam for MinerU-first routing because everything above it already consumes `AssetMap` and stays parser-agnostic.
- Basic structure preservation can start with `DocumentParseResult.structure` and `DocumentParseResult.blocks`; higher layers do not need raw MinerU schemas.
- The current MinerU client implementation is test-backed, but real cloud verification is still blocked by authentication failure with the provided credential.

### External integration blocker
- Real calls to MinerU cloud endpoints returned:
  - `GET /api/v4/quota` -> `401 user authenticate failed`
  - `POST /api/v4/file-urls/batch` -> `401 Unauthorized`
- The failure reproduced both with:
  - `Authorization: Bearer <token>`
  - `Authorization: Bearer <token>` plus `token: <token>`
- Conclusion: the current credential is either not a valid API token for MinerU cloud, not bound to the correct tenant/account, or otherwise not authorized for API use. This is not yet a client-shape problem.

## Resources
- `/e:/test/Docmost/docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase1-orchestrator.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md`
- `/e:/test/Docmost/docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`

## Visual/Browser Findings
- None yet.
