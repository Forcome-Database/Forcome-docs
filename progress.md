# Progress

## 2026-03-20
- Switched planning files from the previous frontend review to the current backend AI audit.
- Confirmed target directories and listed candidate implementation files.
- Started tracing server-side entrypoints before drilling into `agent-service`.
- Confirmed the split between legacy `/ai/creator/generate` and orchestrated `/agent/run` / `/agent/resume`.
- Confirmed that `OrchestratorEngine` is a shared core, but only some intents/routes actually reach the structured section-writing path.
- Verified commit/write-back path via `PageService.commitAiContent(...)` and collaboration/Yjs apply logic.
- Verified that current "optimize" behavior is a route/intention convention (`document_transform`), not a dedicated backend endpoint.
- Verified several architecture mismatches: agent path drops `scope/sourcePolicy/lengthPolicy`; current-page transforms do not become structured assets; multiple dead modules remain in tree with tests but no runtime callers.

## 2026-03-20 External Research Session
- Started external research focused on Anthropic agent patterns and document writing/rewriting product practices.
- Reused the existing planning files by appending a separate research section instead of resetting current backend audit notes.
- Collected official materials from Anthropic, Microsoft Word/Copilot, Notion, BlockNote, and Tiptap.
- Logged evidence in findings.md around workflow vs agent boundaries, accept/reject/review mechanics, explicit context scoping, permission/undo constraints, selection awareness, streaming, and diff/review modes.
- Next step: map the externally validated patterns to Docmost AI Creator's `selection rewrite`, `document transform`, and `blank-page drafting` scenarios, and separate facts from inferences in the final summary.

## 2026-03-20 Redesign Planning Session
- Wrote the approved redesign spec to `docs/superpowers/specs/2026-03-20-ai-creator-document-task-redesign.md`.
- Wrote the implementation plan to `docs/superpowers/plans/2026-03-20-ai-creator-document-task-redesign-implementation.md`.
- Added phased tasks for contract shell, client UI/state cutover, document-task engine, preservation parsing, diff/apply/rollback, and migration cleanup.
- Revised the implementation plan after plan-review feedback to cover source-scope defaults, dedicated inline rewrite API, blank-page/multi-document workflow tasks, deep-collaboration off control, and missing verification suites.

## 2026-03-21 Chunk 1 Execution
- Re-validated Chunk 1 scope against the redesign spec, implementation plan, and current worktree state.
- Confirmed Task 1 contract changes are in place for client intent mapping, Nest strategy/plan helpers, and agent-service protocol schemas.
- Confirmed Task 2 added the document-task API shell (`/ai/document-tasks` plus plan/diff/review/apply/rollback/collab endpoints) while keeping legacy gateway compatibility wiring.
- Confirmed Task 2A added the dedicated inline rewrite API (`/ai/inline/rewrite`) and kept inline rewrite separate from document-task state/history.
- Re-ran the Chunk 1 verification commands and got green results for client, server, and agent-service test suites.
- Stopped at Chunk 1 verification and scope review; did not intentionally advance Chunk 2-4 in this pass.

## 2026-03-22 Live Verification And UI Alignment
- Re-verified the real current-page strict-preservation flow in a headed browser: `/api/ai/document-tasks` returned `201`, `/api/agent/run` streamed `simple_edit -> finalize -> done`, `/apply` returned `201`, and `/rollback` returned `201` with the page markdown restored to the original snapshot.
- Re-verified the real uploaded-document flow with an ASCII-named PDF fixture to avoid Playwright path-encoding false negatives: the shell request sent multipart form data, included the uploaded PDF payload, and stayed on the strict-preservation `simple_edit -> finalize` path without falling back to brief generation.
- Found and fixed an intent-routing bug where prompts like `Do not use the current page` still triggered `uploaded_plus_current_page`; added a failing regression test first, then updated `resolveAiIntent(...)` to treat explicit current-page exclusion phrases as opt-out signals.
- Refined the document-task panel presentation without changing state contracts: stronger header hierarchy, clearer latest-step emphasis, timeline-style activity feed, more legible diff/review and pending-change sections, and localized default expert-collaboration action labels.
- Re-ran client, server, and agent-service verification suites after the latest changes and kept all targeted suites green.
