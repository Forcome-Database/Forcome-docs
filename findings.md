# Findings & Decisions

## Requirements
- Deeply read and analyze the Docmost project’s `aicreate` code.
- Explain the current implementation approach and execution logic.
- Search the internet for best-practice approaches relevant to this feature.
- Diagnose the current design professionally.
- Deliver best-practice optimization recommendations with reasons.

## Research Findings
- Planning workflow initialized before code and web analysis.
- The repository already contains recent uncommitted changes in adjacent AI and content-creation areas, so analysis should avoid assuming HEAD reflects runtime behavior.
- `aicreate`/AI Creator spans multiple layers: client-side aside/panel/input/message components, server-side AI APIs and content mutation services, plus a separate `agent-service` for deep/agent workflows.
- The repository includes extensive internal design and changelog documents for AI Creator, which can help reconstruct intent but must be validated against current code.
- Frontend primary orchestration appears concentrated in `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`; this file owns prompt submission, file upload intake, streaming editor insertion, stop handling, and agent-mode routing.
- Standard generation path uses `apps/server/src/ee/ai/ai.controller.ts` endpoint `POST /ai/creator/generate` with SSE streaming.
- Deep/agent path uses `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` to proxy `run`, `resume`, and `stop` requests to the Python `agent-service`.
- `agent-service/app/agent/graph.py` defines a 5-stage interruptible LangGraph flow: explorer -> clarifier -> proposer -> outliner -> writer -> reviewer.
- The current implementation has two materially different orchestration paths:
  - Standard mode: client `ai-creator-input.tsx` -> `creatorGenerate()` -> NestJS `POST /ai/creator/generate` -> `AiService.streamWithContext()`.
  - Deep mode: client `useAgent` / `agent-service.ts` -> NestJS `agent-gateway` -> Python FastAPI `agent-service` -> LangGraph nodes -> SSE queue.
- Final document mutation is still primarily client-owned. Both standard and deep mode eventually insert generated markdown into TipTap from the browser; the backend does not own authoritative content application for AI output.
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` has very high responsibility concentration: prompt assembly, history shaping, selection validation, file intake, streaming state, editor rollback/lock integration, standard-mode flow, and agent-mode flow all live in one component.
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx` duplicates parts of the streaming/resume lifecycle that already exist in `use-agent.ts` and `ai-creator-input.tsx`, indicating protocol handling is not fully centralized.
- Stop semantics are inconsistent:
  - Frontend `useAgent.stop()` only aborts the browser request.
  - NestJS and FastAPI both expose `/agent/stop`.
  - `agent-service` emits `X-Task-Id`, but the frontend never captures or submits it, so backend cancellation is effectively not wired.
- Standard-mode protocol appears drifted:
  - NestJS `POST /ai/creator/generate` now supports outline-first behavior and emits `await_input` when `confirmedOutline` is absent.
  - Client `creatorGenerate()` and normal-mode `handleSubmit()` only handle `{content}` chunks and have no resume path or `confirmedOutline` field.
  - The normal frontend therefore does not match the server’s two-phase contract.
- DTO drift exists as well: `apps/server/src/ee/ai/dto/ai-creator.dto.ts` does not reflect currently handled fields such as `history` or `confirmedOutline`.
- Automated test coverage around AI Creator is sparse. The repo contains `agent-service/tests/test_main.py` for health only, but no obvious frontend or NestJS tests for the AI Creator protocol, resume flow, cancellation flow, or selection-write behavior.
- Phase 1 implementation closed several of the previously identified gaps:
  - Standard creator outline behavior is now opt-in rather than the default, which restores compatibility with the existing normal-mode frontend.
  - The client now retains and shares the current agent `taskId` across hooks/components, so stop requests can propagate to `/agent/stop`.
  - Agent cancellation is now enforced at node boundaries via graph wrappers and within the long-running explorer/writer loops.
  - Targeted tests now exist for session/history helpers, creator-flow planning gating, and agent cancellation.
- Phase 2 implementation consolidated client-side orchestration:
  - `use-ai-create-session.ts` now owns run/resume/cancel state transitions, message accumulation, agent step tracking, and editor writeback side effects.
  - `ai-creator-input.tsx` now focuses on prompt/files/template UI instead of owning SSE orchestration and editor mutation logic.
  - `ai-creator-messages.tsx` now renders conversation state and delegates bubble actions back to the shared session hook.
  - Obsolete session atoms plus the legacy `use-agent.ts` hook were removed, leaving a single owner for client-side AI Creator execution.
- Phase 7 implementation has now unified the runtime event contract:
  - `ai-create-runner.ts` normalizes standard mode and agent mode into one event model before session orchestration sees them.
  - The standard creator SSE endpoint now emits typed events (`content_delta`, `await_input`, `done`, `error`) instead of relying on implicit `{ content }` payload shape.
  - The client parser remains backward-compatible with legacy standard-mode `content` chunks, reducing rollout risk.
- The next architectural boundary is now clearer:
  - Current server-side page updates only support whole-document `append`, `prepend`, and `replace` through collaboration events.
  - A true server-authoritative AI commit will require a new range-aware mutation primitive that can validate and replace a selection snapshot, plus revision/conflict checks.
- Phase 8 implementation is now underway:
  - `POST /ai/creator/commit` now validates page edit permissions and forwards AI writeback to the server-owned page mutation path.
  - The collaboration layer now has an `applyAiCommit` custom event that reads the current Yjs document state, validates selection snapshots, and applies append/overwrite/replace atomically inside a direct transaction.
  - AI commit conflict detection currently uses `page.updatedAt` as the optimistic concurrency token.
  - Stale replace selections now fall back to append on the server and report `fallbackReason: "stale_selection"` back to the client.
  - The client session hook no longer streams generated markdown directly into TipTap; it only commits after generation completes.
  - Because browser-side rollback is gone, cancel/error/reset now only unlock the editor, which avoids clobbering remote collaboration updates with a stale local snapshot.
  - Focused Nest tests now cover `PageService.commitAiContent()` conflict handling, required replace snapshots, fallback propagation, and `AiController.creatorCommit()` permission/not-found forwarding behavior.
  - The AI Creator `autoInsert` copy has been updated to match the new architecture: generation stays in chat until completion, then the server applies the result to the page.
- External best-practice consensus from official docs:
  - Anthropic recommends choosing the simplest workflow that can solve the task, using deterministic workflows before reaching for fully agentic systems, and treating tool/agent shape as an explicit design choice rather than an implementation detail.
  - OpenAI recommends separating objective, rules, and steps in prompts; using structured outputs or JSON schema when the response needs machine consumption; and writing evals before prompt changes.
  - LangGraph’s official guidance centers human-in-the-loop flows on explicit `interrupt` checkpoints plus thread-based persistence, and warns that durable execution requires careful handling of side effects and idempotency.
- These best practices align with the strongest local concerns: protocol drift between standard and deep mode, too much orchestration hidden in UI components, weak typing of intermediate artifacts, and non-authoritative content mutation in the browser.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat `aicreate` as a cross-layer feature until proven otherwise | The repo contains client, server, and agent-service changes touching AI creation adjacent areas |
| Treat protocol drift as a top diagnostic concern | The current code suggests the AI Creator feature evolved faster than its shared contracts |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| PowerShell output shows mojibake for Chinese comments/strings in several files | Interpreted behavior from code structure and cross-file consistency rather than trusting console rendering of non-ASCII text |

## Resources
- Local skill template: `E:\test\Docmost\.agents\skills\planning-with-files\SKILL.md`
- Repo root: `E:\test\Docmost`
- AI Creator docs: `E:\test\Docmost\docs\ai-creator-changelog.md`
- AI Creator 5-stage refactor doc: `E:\test\Docmost\docs\ai-creator-5stage-refactor.md`
- Frontend orchestrator: `E:\test\Docmost\apps\client\src\ee\ai\components\ai-creator\ai-creator-input.tsx`
- Server controller: `E:\test\Docmost\apps\server\src\ee\ai\ai.controller.ts`
- Agent gateway: `E:\test\Docmost\apps\server\src\ee\ai\agent-gateway\agent-gateway.controller.ts`
- Agent graph: `E:\test\Docmost\agent-service\app\agent\graph.py`
- OpenAI Prompt Engineering Guide: https://platform.openai.com/docs/guides/prompt-generation
- OpenAI Model Optimization / Structured Outputs note: https://platform.openai.com/docs/guides/optimizing-llm-accuracy
- Anthropic Building Effective Agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic Tool Use Best Practices: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
- LangGraph Human-in-the-loop: https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/add-human-in-the-loop/
- LangGraph Persistence: https://langchain-ai.github.io/langgraph/how-tos/persistence/
- LangGraph Durable Execution: https://langchain-ai.github.io/langgraph/concepts/durable_execution/

## Visual/Browser Findings
- Internal docs confirm the intended architecture evolved from a simple create/edit/chat panel to a 5-stage human-in-the-loop workflow using LangGraph interrupts, outline confirmation, and chunked SSE proxying.
- Official docs emphasize explicit checkpoints, durable thread state, structured intermediate outputs, evaluation discipline, and careful side-effect handling in long-running AI workflows.

## Phase 4 Handoff Summary

### Unified Event Contract
- Standard mode now emits typed SSE events from `POST /ai/creator/generate`: `content_delta`, `await_input`, `done`, and `error`.
- Agent mode still speaks its richer backend SSE dialect (`step_start`, `step_done`, `content`, `content_clear`, `image`, `await_input`, `session`, `done`, `error`, `cancelled`), but the client no longer consumes that raw shape directly.
- `apps/client/src/ee/ai/services/ai-create-runner.ts` and `ai-create-runner.utils.ts` now normalize both transports into one client event contract:
  - `task`
  - `session`
  - `step_start`
  - `step_done`
  - `content_delta`
  - `content_cleared`
  - `await_input`
  - `done`
  - `error`
  - `cancelled`
- `use-ai-create-session.ts` is now the single orchestration owner for both modes. Input/messages components render state and dispatch intents, but no longer own protocol differences.

### Server-Authoritative Commit Contract
- Final writeback now happens through `POST /ai/creator/commit` instead of browser-side editor mutation.
- Request contract:
  - `pageId`
  - `content` (markdown)
  - `insertMode`: `create | append | overwrite | replace`
  - `expectedUpdatedAt`
  - `selectionSnapshot` required for `replace`
- Server behavior:
  - validates page existence and page-edit authorization
  - parses markdown into ProseMirror JSON
  - acquires a collaboration document lock
  - re-checks `updatedAt` for optimistic concurrency
  - applies the mutation against the current in-memory Yjs state
- Conflict behavior:
  - stale `expectedUpdatedAt` returns HTTP 409
  - message is effectively “page changed during generation; keep/review draft and retry”
- Stale-selection behavior:
  - `replace` first validates `{ text, from, to }` against current document text
  - invalid snapshots fall back to append
  - response reports `appliedMode: "append"` and `fallbackReason: "stale_selection"`
- Runtime validation now confirms:
  - direct append persists correctly
  - stale-selection fallback persists correctly
  - an already-settled collaborative editor session receives subsequent append updates

### Remaining Technical Debt
- Concurrency token still uses `page.updatedAt`; it works, but a dedicated monotonic revision/version would be more explicit and less timing-sensitive.
- Browser validation was done with Playwright CLI and real API calls, not a checked-in CI E2E suite. Regressions could still slip if no automated browser test is added.
- Commit failure UX is safe but minimal: drafts remain in chat, yet there is no explicit “retry commit” action or richer recovery workflow.
- `autoInsert=false` still means “draft stays in chat for manual action”, but there is no first-class manual apply flow that reuses the same server-authoritative commit endpoint.
- Planning artifacts still contain older phase-status snapshots in `progress.md`’s reboot section; they don’t affect code, but they are now stale historical text.

### Next-Phase Backlog
1. Add a small CI-owned browser E2E that covers `409 conflict`, `stale_selection -> append`, and live collaborative propagation.
2. Replace `updatedAt` optimistic concurrency with a true revision counter or document version.
3. Add explicit client recovery UX for commit failures: retry commit, apply draft manually, and clearer conflict messaging.
4. Decide whether manual insert should also route through `creator/commit` for one consistent write path.
5. If agent mode grows further, formalize the normalized event contract as a shared type/schema across client, Nest gateway, and Python agent service.

---
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
- Phase 8 browser/API validation using the Playwright CLI skill is now active against the local dev app with a locally signed authToken injected into the browser session.
- Real runtime validation exposed a production bug: `creator/commit` returned `appliedMode: append` but append results were initially a no-op under the actual markdown -> TipTap schema pipeline.
- The bug was narrowed to `applyAiCommitToDocument()` append/fallback behavior rather than transport or persistence; after patching append to concatenate top-level document content directly, real API validation now shows correct persisted markdown for both direct append and stale-selection fallback.
- Real API validation now confirms:
  - conflict path returns HTTP 409 after the page changes during generation,
  - stale selection returns `appliedMode: append` with `fallbackReason: stale_selection`,
  - persisted page markdown includes the appended fallback content after the fix.
- A first Playwright check appeared to miss the live update in the open editor, but a follow-up validation after letting the page settle and establish collaboration state showed the committed content arriving in the active editor view as expected. The earlier miss was likely a timing/connection-readiness issue during page navigation rather than a persistence bug.

## 2026-03-13: AI documentation assistant redesign findings

- Standard creator mode does load the workspace global system prompt plus the selected template prompt, but it concatenates them into a single free-form `systemPrompt` string and sends only plain text/messages into `streamWithContext()`. There is no structured output schema, no explicit tool policy, and no quality rubric attached to that prompt contract.
- Agent mode is materially weaker on prompt fidelity:
  - `templateId` is forwarded to `agent-service`, but nodes only mention the template key as context text such as “selected template: technical-doc”.
  - The actual template prompt body is never resolved or injected into the agent nodes’ system prompts.
  - The workspace global `systemPrompt` is not forwarded into agent mode at all.
  - This means the user-observed “system prompt / template prompt seems ineffective” is correct for agent mode and only partially false for standard mode.
- Agent orchestration currently restricts research planning to `search | parse | crawl` actions in `explorer.py`.
  - Available tools include `docling_parser`, `tavily_search`, `firecrawl_scrape`, `docmost_page_read`, `docmost_rag`, `nanobana_imggen`, `vlm_understand`, and image upload helpers.
  - But the explorer plan never emits image generation, visual understanding, internal RAG, page-read, or evidence-verification steps.
  - Even for `search`, the code force-falls back to `tavily_search`; internal knowledge retrieval is not part of the normal plan loop.
- The writer is essentially a single-pass markdown writer:
  - it receives `confirmed_outline`, clipped page text, selected text, parsed file text, and top-N research snippets;
  - it streams markdown prose;
  - it has optional image placement instructions if images were extracted from uploaded files;
  - it does not produce a typed document plan or node-level structure plan before writing.
- The reviewer is not a substantive reviewer. It only auto-fixes formatting issues around empty image syntax and whitespace. There is no factual review, coverage review, citation check, structure check, or “did we use the right artifact type?” check.
- Current editor capability is richer than current prompting/orchestration:
  - `editor-ext` supports tables, callouts, details blocks, code blocks, math, images, and markdown transforms.
  - Markdown conversion explicitly supports tables via GFM and callouts via `:::info|success|warning|danger`.
  - Details blocks can be inserted with `:::details`.
  - Drawio / Excalidraw exist as editor nodes, but they are not naturally reachable from current markdown generation.
- The AI create pipeline currently gives the model mostly plain text context, not the document’s structured ProseMirror shape or a target block schema. This makes it much more likely to overproduce prose and underproduce the editor’s richer structural affordances.
- File handling is asymmetric:
  - Standard mode uses lightweight extraction (`pdf-parse`, `mammoth`, raw image pass-through).
  - Agent mode has a better parser (`docling_parser`) that can extract text plus embedded images from documents and upload those images back into Docmost.
  - This capability exists, but only uploaded-file images are considered. The plan does not proactively search for missing illustrative images, nor does it decide when a diagram/table/image is required.
- The current system has tools, but not a “tooling policy”.
  - There is no rule like “if the user asks for a tutorial/manual and source material includes screenshots, preserve them”.
  - There is no rule like “if comparing options, prefer a table”.
  - There is no rule like “if architecture/process is discussed, emit mermaid”.
  - There is no rule like “if evidence is weak, search or ask a clarifying question before drafting”.
- Current official guidance aligns with a different shape:
  - OpenAI recommends structured outputs over plain JSON mode for reliable schema matching, recommends Responses API for agentic multi-tool loops, and recommends evals tied to document tasks.
  - Anthropic recommends using the simplest workflow that works and writing detailed tool descriptions/instructions so the model knows when to use tools.
  - LangGraph guidance emphasizes interrupt checkpoints, persistence, and careful side-effect boundaries, which matches Docmost’s outline confirmation flow but not its current weak quality gate.
- Inference from local code + official guidance:
  - The main gap is not “prompt wording is bad”.
  - The main gap is that prompts are carrying responsibilities that should be split into: document brief, evidence plan, artifact plan, structure schema, tool policy, and quality gate.

## 2026-03-13: Implemented quality-upgrade delivery

- Added a template-aware document strategy layer on the server:
  - `apps/server/src/ee/ai/document-strategy.ts`
  - standard creator mode now appends an explicit document strategy section to its prompt
  - agent mode now resolves and forwards `system_prompt`, `template_prompt`, and `document_strategy`
- Added a hidden structured planning step before outline generation:
  - `agent-service/app/agent/nodes/planner.py`
  - `agent-service/app/agent/document_strategy.py`
  - planner produces a normalized `document_plan` with sections, required artifacts, and evidence targets
- Upgraded the explorer from a shallow `search|parse|crawl` planner to a richer evidence planner:
  - now supports `page_read`, `knowledge_search`, `vision`, and `image`
  - now consumes document strategy signals to decide when diagrams, tables, screenshots, or extra evidence are required
- Closed the runtime tool bridge gap with new internal server endpoints:
  - `POST /api/ai/internal/page-read`
  - `POST /api/ai/internal/knowledge-search`
  - `POST /api/ai/internal/upload-page-image`
  - this removes the prior mismatch where agent-side Docmost tools were calling auth-protected user endpoints or an SSE endpoint as if they were JSON APIs
- Upgraded writing and review stages:
  - writer now consumes `system_prompt`, `template_prompt`, `document_strategy`, `document_plan`, page context, parsed files, and research results together
  - reviewer is now an LLM-based quality gate that checks strategy/plan coverage and can return a revised draft instead of only fixing whitespace/image syntax
- Kept the output format aligned with existing editor capabilities instead of inventing a new renderer:
  - tables
  - mermaid
  - fenced code blocks
  - Docmost callouts
  - details blocks
  - markdown images

## Recommended next backlog after this delivery

1. Add browser E2E coverage for the new agent documentation flow, especially image/tool usage and outline approval.
2. Add evaluator datasets for artifact usage rate, source grounding rate, user-requirement coverage, and generic-prose regression.
3. Move from hidden `document_plan` only to an explicit first-class typed contract shared across server and agent-service.
4. Decide whether image generation should be gated by a stricter approval policy for non-user-provided visuals.
5. If document quality stabilizes, then consider deeper block-level rendering beyond markdown-compatible structures.

## 2026-03-13: Deterministic review hardening

- Reviewer quality control is no longer purely prompt-dependent.
- Added `agent-service/app/agent/quality_checks.py` to deterministically inspect:
  - required artifacts from strategy + document plan
  - required section headings from strategy + document plan
  - long-form prose drafts that lack markdown section structure
- Reviewer now feeds deterministic precheck issues into the LLM review prompt and preserves `needs_revision` when these hard checks fail.
- Added regression tests covering:
  - missing required artifacts / sections
  - acceptable drafts that satisfy required headings and artifact usage

## 2026-03-13: Minimal eval fixture added

- Added a reusable eval case dataset:
  - `agent-service/tests/fixtures/document_quality_eval_cases.json`
- Added a dedicated regression test runner:
  - `agent-service/tests/test_quality_evals.py`
- Current fixture cases cover:
  - technical documentation missing a required code block
  - an operations manual draft that correctly uses warning callouts and an image
  - a report draft that uses a table but misses a required findings section
- This is not yet a full model-based eval system, but it turns the documented quality bar into repeatable repository checks and gives a clean place to keep growing the dataset.

## 2026-03-13: Browser smoke automation added

- Added a reusable DrissionPage-based browser smoke script:
  - `agent-service/tests/browser_ai_creator_smoke.py`
- The script now:
  - creates a temporary page through the real server API
  - signs a real `authToken` using local `.env` settings
  - opens the Vite client in a real Chromium session
  - enables `aiAgentMode=true` and `aiAutoInsert=false`
  - opens the AI Creator panel from the real page header
  - submits a prompt through the real UI
  - waits for real runtime response markers such as `AI 正在写作` or `需要进一步了解`
- The browser selector was hardened after a flaky rerun:
  - the AI Creator trigger is now located relative to the visible `分享` button instead of assuming a fixed far-right viewport position
- Local runtime validation confirms the browser path reaches live AI execution rather than failing at auth, panel open, or submit.

## Updated Source Links

- OpenAI prompt guidance: https://developers.openai.com/api/docs/guides/prompt-guidance/
- OpenAI reasoning best practices: https://developers.openai.com/api/docs/guides/reasoning-best-practices/
- OpenAI prompt engineering: https://developers.openai.com/api/docs/guides/prompt-engineering/
- Anthropic building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic tool use: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
- LangGraph human-in-the-loop: https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/add-human-in-the-loop/
- LangGraph persistence: https://langchain-ai.github.io/langgraph/how-tos/persistence/
- LangGraph durable execution: https://langchain-ai.github.io/langgraph/concepts/durable_execution/
- Docling docs: https://docling-project.github.io/docling/
- Firecrawl scrape docs: https://docs.firecrawl.dev/features/scrape

## 2026-03-13: Browser insert E2E hardening and regression fix

- Added a stricter browser regression script:
  - `agent-service/tests/browser_ai_creator_insert_e2e.py`
- The stricter scenario now validates a full real-user path:
  - create a temporary page through the real server API
  - open the real Vite client with a signed auth cookie
  - submit a prompt that demands a heading, markdown table, and mermaid flowchart
  - wait for the assistant draft to finish rendering in the AI panel
  - click the real "Insert to editor" action in the chat UI
  - verify both editor-side structure and persisted markdown on the server
- The first strict run exposed a real standard-mode writeback bug:
  - persisted page content contained concatenated JSON fragments like `{"content":"##"}` instead of plain markdown
  - inference from the local code path: `AiService.streamWithContext()` was already yielding `JSON.stringify({ content: chunk })`, and `AiController.creatorGenerate()` wrapped that value again into `content_delta.chunk`
- Fixed the server-side chunk contract:
  - `apps/server/src/ee/ai/services/ai.service.ts` now yields raw text chunks from `streamWithContext()`
  - added `apps/server/src/ee/ai/services/ai.service.spec.ts` to lock the regression
- Verified locally on Friday, March 13, 2026:
  - browser result contained the required heading and markdown table
  - the editor showed the heading, a rendered table, and the mermaid content
  - persisted markdown on the temporary page contained:
    - `## Browser E2E Marker ...`
    - a markdown table with `Approach` and `Note`
    - a fenced mermaid block with `Client --> Server`
- This completes the browser-level validation that structured AI output can be inserted into the live page.
- The remaining unchecked Phase 6 item is only the separate git-history step; no commit was created in this session.
