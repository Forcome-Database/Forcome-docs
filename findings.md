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

## 2026-03-13: Typed document-plan contract boundary

- The next implementation boundary is now concrete rather than conceptual.
- Server side:
  - `apps/server/src/ee/ai/document-strategy.ts` exposes an explicit `AiDocumentStrategy` interface, but there is no corresponding first-class `document_plan` type.
  - `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` forwards `document_strategy` into `agent-service`, but there is still no typed request boundary for a plan shape because planning happens only inside Python.
- Agent side:
  - `agent-service/app/agent/nodes/planner.py` already defines the expected `document_plan` JSON shape in prompt text.
  - `agent-service/app/agent/document_strategy.py` normalizes that output, but returns a loose `dict[str, Any]`.
  - `agent-service/app/agent/state.py` and `agent-service/app/schemas/request.py` still model `document_plan` and `document_strategy` as plain dictionaries.
  - `quality_checks.py`, `writer.py`, `outliner.py`, and `reviewer.py` all consume the same loose shape.
- Practical implication:
  - the repository already has a de facto contract for `document_plan`, but it is duplicated across prompt prose, normalization logic, and tests rather than represented as a reusable typed model.
  - the next safe refactor is to extract that contract into shared Python types first, then add a matching server-side type/schema for parity and tests.

## 2026-03-13: Typed document-plan contract implemented

- The `document_plan` shape is now a first-class shared contract instead of a loose convention.
- Python side:
  - added `agent-service/app/schemas/document_contracts.py`
  - explicitly defines:
    - document artifacts: `table | mermaid | code_block | image | callout | details`
    - evidence sources: `uploaded_files | page_context | page_read | knowledge_search | web_search | web_crawl | vision | generated_image`
    - `AiDocumentStrategy`, `AiDocumentPlanSection`, and `AiDocumentPlan`
  - `agent-service/app/agent/state.py` now types `document_strategy` and `document_plan` against that shared contract.
  - `agent-service/app/schemas/request.py` now validates incoming `document_strategy` against the typed contract instead of a raw `dict`.
  - `agent-service/app/agent/document_strategy.py` now returns a typed normalized plan and canonicalizes legacy evidence aliases such as:
    - `search -> web_search`
    - `crawl -> web_crawl`
    - `knowledge_base -> knowledge_search`
    - `image_generation -> generated_image`
  - `agent-service/app/main.py` now initializes state with an explicit empty normalized plan rather than `{}`.
  - `outliner.py`, `writer.py`, `reviewer.py`, and `quality_checks.py` now normalize the plan before consumption, so downstream logic runs against one stable shape.
- Server side:
  - added `apps/server/src/ee/ai/document-plan.ts`
  - the Nest side now has explicit `AiDocumentPlan`, `AiDocumentPlanSection`, artifact, and evidence-source types plus a mirrored normalization helper.
  - `apps/server/src/ee/ai/document-strategy.ts` now reuses the same artifact type for `requiredArtifacts` and `optionalArtifacts`, which removes another source of string drift.
- Test impact:
  - both Python and TypeScript now have regression tests that lock:
    - strategy-default section expansion
    - evidence alias normalization into canonical contract values
- Practical effect:
  - planner prompt, state, review/eval logic, and future gateway/server integration now have one concrete shape to build on instead of repeating JSON examples in prompt text.

## 2026-03-13: Runtime interrupt and SSE contracts tightened

- The next drift point after `document_plan` was the live agent protocol itself.
- Before this pass:
  - client `AgentSSEEvent` was effectively `type + any`
  - client `resumeValue` was `Record<string, any>`
  - server DTO `AgentResumeDto` accepted `Record<string, any>`
  - Python request/response schemas did not explicitly model:
    - clarify answer payloads
    - proposal selection payloads
    - outline confirm/regenerate payloads
    - `cancelled` as a first-class SSE event
- Implemented contract tightening:
  - client `apps/client/src/ee/ai/types/agent.types.ts` now defines:
    - typed await-input payloads for `clarify`, `propose`, and `outline`
    - a typed `AgentResumeValue` union
    - a discriminated `AgentSSEEvent` union instead of `[key: string]: any`
  - client runtime normalization now validates both:
    - `phase`
    - payload shape compatibility with that phase
  - malformed interrupt payloads are now dropped before reaching session state
  - `use-ai-create-session` and the interactive bubble components now propagate typed resume values instead of free-form objects
  - server `AgentResumeDto` now reuses an explicit `AgentResumeValue` type via `agent-gateway.types.ts`
  - Python `AgentResumeRequest` now validates against explicit resume payload models
  - Python `response.py` now models:
    - typed await-input data unions
    - `phase` as `clarify | propose | outline`
    - `CancelledEvent`
- Practical effect:
  - the agent interrupt loop is no longer “typed inside one file but untyped on the wire”
  - future changes to clarify/propose/outline bubbles or resume behavior now have a concrete protocol surface to update and test
  - the client now has a defensive runtime check against mismatched SSE interrupt payloads rather than trusting JSON blindly

## 2026-03-13: Python event queue now validates emitted SSE payloads

- The last weak point in the protocol path was the emitter itself.
- Before this pass:
  - `agent-service/app/agent/events.py` accepted any dictionary and pushed it directly into the SSE queue
  - even after adding typed request/response schemas, producer code could still enqueue undeclared or mismatched payloads
- Implemented change:
  - `events.py` now validates every emitted event through the shared `SSEEvent` response schema before queueing it
  - validated events are normalized via `model_dump()` before they leave the agent runtime
  - `AwaitInputEvent` now performs cross-field validation so `phase` must match `data.type`
- Concrete bug caught and fixed during this pass:
  - `phase="outline"` with `data.type="clarify"` still passed union validation before the new cross-field validator
  - this is now rejected explicitly
- Practical effect:
  - the Python agent is no longer just “typed by convention”; invalid SSE payloads now fail at the producer boundary
  - the client-side interrupt normalization and the agent-side event emission are now both defensive against protocol drift

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

## 2026-03-13: Playwright CLI validation of the agent interrupt flow

- Browser validation has now been re-run with the `playwright` CLI skill instead of DrissionPage.
- Playwright-specific environment finding:
  - opening `http://localhost:5173` from the CLI session fell into `chrome-error://chromewebdata/` with `ERR_CONNECTION_REFUSED`
  - inference from the live behavior: the headed Playwright browser session in this environment could not reuse the normal `localhost` path reliably, but the app was reachable through the machine LAN origin exposed by Vite
  - using `http://192.168.17.26:5173`, then setting `authToken` on that domain, allowed the real app to load and stay authenticated
- Live Playwright run result:
  - opened the real page and AI panel
  - submitted an agent prompt
  - answered the clarify bubble
  - selected and confirmed a proposal
  - confirmed the outline
  - waited for the final draft
  - clicked the real chat-side insert action
  - verified the inserted content in the editor and via `/api/pages/info` markdown fetch
- Important root-cause finding for the currently failing `browser_ai_creator_agent_outline_e2e.py` script:
  - the script uses document-wide button text scanning and requires `clarify`, `propose`, and `outline` buttons to disappear before it treats the run as successful
  - this assumption is false for the real UI, because historical interrupt bubbles remain mounted in chat after resume
  - as a result, once the flow has shown any interrupt, the script's final success condition is logically unreachable even when the agent run has already completed successfully
- Additional product-quality finding from the same Playwright run:
  - the agent flow is now functionally resumable end-to-end, but its final draft still does not obey strict prompt-shape constraints reliably enough for a very brittle golden-output assertion
  - in the validated run, the final page contained:
    - the requested marker heading
    - a rendered markdown table
    - a mermaid block
    - successful editor insertion and persisted markdown
  - but it did not preserve the exact requested `Approach | Note` two-column table nor the exact minimal `Client --> Server` flowchart; it expanded the content into a richer comparison table plus a sequence diagram
- Practical implication:
  - the next automated browser regression should separate flow assertions from exact-content assertions
  - flow assertions can and should cover clarify/propose/outline/resume plus final insert/persist
  - strict content-shape assertions should only be kept for scenarios where the model is already constrained tightly enough to make them stable
- Recommended next browser-testing direction:
  - stop investing further in DrissionPage-based agent coverage
  - replace the unfinished agent browser regression with a Playwright-owned path, preferably asserting:
    - interrupt stages are reachable and actionable
    - outline approval resumes generation
    - final draft becomes insertable
    - insert persists to page markdown
    - at least one required artifact such as a table or mermaid block survives end-to-end

## 2026-03-13: Playwright-owned agent outline regression is now passing

- `agent-service/tests/browser_ai_creator_agent_outline_e2e.py` has now been rewritten to drive the browser through Playwright CLI instead of DrissionPage.
- The new script keeps the same real-environment assumptions:
  - create a temporary page through the real server API
  - sign a real `authToken` from local `.env`
  - open the live Vite app in a real browser session
  - submit a deep-mode prompt through the AI Creator panel
  - walk the clarify -> propose -> outline -> final draft -> insert chain
- The main design correction in the script:
  - interrupt handling is now sequential and stateful
  - the script no longer expects old interrupt controls to disappear from chat history
  - success is based on `outline handled + final draft rendered + insert actions available`, which matches the actual UI behavior
- The main browser-automation correction in the script:
  - clarify answers must be injected with the native textarea `value` setter before dispatching `input/change`
  - direct `textarea.value = ...` assignment was not enough for the live React-controlled bubble input
- The new regression intentionally uses broader, product-stable assertions instead of brittle golden-output matching:
  - persisted markdown must contain the generated marker heading
  - persisted markdown must contain a markdown table
  - persisted markdown must contain a mermaid block
  - the live editor must reflect marker + table + mermaid-bearing content after insert
- Local validation result on Friday, March 13, 2026:
  - the Playwright CLI-driven agent outline E2E passed
  - outline approval resumed generation successfully
  - the chat-side insert action persisted the final draft to the page
  - browser-side editor validation reported:
    - `has_marker: true`
    - `has_table: true`
    - `has_mermaid: true`
- This closes the previously unfinished browser coverage item for the agent outline approval flow.

## 2026-03-13: Browser automation is now fully Playwright CLI-based

- The browser regression path no longer depends on DrissionPage.
- Added a shared helper:
  - `agent-service/tests/playwright_ai_creator_utils.py`
- That helper now owns the common real-browser workflow:
  - create a temporary page through the real server API
  - sign a real `authToken`
  - open the live Vite app in a named Playwright CLI session
  - inject creator preferences through `localStorage`
  - wait for the editor to be ready
  - open the AI Creator panel
  - inject prompts safely and click the real send action
  - insert the final draft into the editor
  - verify persisted markdown and live editor artifacts
- The remaining Playwright migration work is now complete for the checked-in browser scripts:
  - `agent-service/tests/browser_ai_creator_smoke.py`
  - `agent-service/tests/browser_ai_creator_insert_e2e.py`
  - `agent-service/tests/browser_ai_creator_agent_outline_e2e.py`
- Important Windows-specific implementation finding:
  - large markdown prompts cannot be passed directly inside `run-code` arguments when the Playwright CLI is launched through `npx.cmd`
  - characters such as table pipes and mermaid fences can be misinterpreted by the Windows command path before the browser ever sees them
  - the stable fix is to base64-encode the prompt in Python and decode it inside the browser before dispatching `input/change`
- Additional Windows-specific implementation finding:
  - `json.dumps(..., ensure_ascii=False)` can fail on the local console with `UnicodeEncodeError` under the default `gbk` code page
  - the browser scripts now print ASCII-safe JSON for CLI stability; this does not affect test logic
- Updated local validation on Friday, March 13, 2026:
  - `python agent-service/tests/browser_ai_creator_smoke.py` passed
  - `python agent-service/tests/browser_ai_creator_insert_e2e.py` passed
  - `python agent-service/tests/browser_ai_creator_agent_outline_e2e.py` passed
- The agent outline regression now uses more product-stable assertions than the first DrissionPage draft:
  - it still requires a successful clarify/propose/outline/insert chain
  - it still checks persisted markdown and editor artifacts end-to-end
  - but it no longer assumes the model will always preserve one exact golden-output table shape or one exact minimal mermaid body, which had already proven unstable in live runs

## 2026-03-13: Quality eval coverage now includes user-requirement coverage and generic-prose regressions

- Deterministic review is no longer limited to artifact and heading presence.
- `agent-service/app/agent/quality_checks.py` now also checks:
  - missing coverage points derived from strategy `objectives`
  - missing coverage points derived from document-plan section `must_cover` requirements
  - long generic-prose drafts that still miss required coverage and provide no meaningful structure or artifact support
- This makes the repository-level evals better aligned with the actual product goal:
  - not just “did the draft include a table?”
  - but also “did the draft actually cover the requested content points?”
- Expanded fixture-backed eval cases now cover:
  - missing required coverage points in an operational/manual-style draft
  - generic-prose regression where the draft is long and plausible-sounding but still misses key required points
- Updated focused tests now pass locally on Friday, March 13, 2026:
  - `python -m pytest agent-service/tests/test_document_strategy.py agent-service/tests/test_quality_evals.py`
  - `python -m py_compile agent-service/app/agent/quality_checks.py agent-service/tests/test_document_strategy.py agent-service/tests/test_quality_evals.py`
- Practical impact:
  - the reviewer precheck can now reject drafts that look polished but fail user-intent coverage
  - eval fixtures can now catch regressions where the model drifts back into generic documentation prose without covering explicit must-have requirements

## 2026-03-13: Delivery readiness

- The original redesign scope is now in deliverable state.
- Final local delivery gates now cover:
  - typed document-plan and interrupt/resume contracts across client, server, and agent-service
  - deterministic quality gates plus reusable eval fixtures
  - Playwright CLI-based smoke, insert, and agent outline browser regressions
  - a final re-run of the Playwright agent outline flow after the latest runtime contract hardening changes
- Remaining work is hardening backlog rather than a blocker for handoff:
  - CI-hosted browser automation
  - replacing `updatedAt` with a dedicated revision counter
  - richer retry/manual-commit UX for conflict recovery

## 2026-03-13: Follow-up diagnosis for live AI Creator pain points

- Current intent routing is mode-driven, not task-driven:
  - the client only switches between standard and agent flows via `agentMode`, while selection is merely attached as context and does not alter the workflow path.
  - `use-ai-create-session.ts` builds a restrictive local-edit prompt for selections, but still routes to the full agent flow whenever `agentMode` is enabled.
- The deep/agent graph remains globally document-oriented even when the request is clearly a local edit:
  - `graph.py` always enters `explorer -> clarifier -> proposer -> planner -> outliner -> writer -> reviewer`.
  - there is no branch for direct in-place edit / patch / rewrite-on-selection behavior.
- Uploaded-document information is carried, but not prioritized strongly enough:
  - standard mode extracts only plain text/images through `pdf-parse` and `mammoth`, which loses structural cues.
  - agent mode parses files with `docling_parser`, but downstream nodes still treat parsed file content as one evidence bucket among many rather than the primary source document to preserve and transform.
- The resulting product mismatch is predictable:
  - users asking "optimize this uploaded document" expect transform/edit behavior anchored to the source artifact.
  - the current flow interprets the same request as "generate a new document after clarification/planning/outline", which compresses or replaces the original material.

## 2026-03-13: External product-pattern comparison

- Microsoft Word Copilot exposes selection-scoped rewrite flows with explicit apply behavior; this matches user expectations for local editing rather than forcing a new-document workflow.
- GitHub Copilot documents separate modes for lightweight inline edits versus broader agent/task flows; this supports the conclusion that Docmost should route by intent granularity, not one global SOP.
- Cursor documentation/search results describe selection/file-scoped inline editing as distinct from broader chat/agent workflows, reinforcing the same routing principle.
- Cross-product pattern: high-performing AI editors keep three layers distinct:
  - inline selection edit
  - document-level rewrite/transform
  - multi-step research/agent creation
- Cross-product pattern: uploaded or selected source material remains the primary context object for transform tasks, rather than being reduced to optional background context.
- Additional product requirement clarified by the user on 2026-03-13:
  - explicit user instructions must outrank system defaults such as “preserve length”, “keep source structure”, or “skip compression”
  - defaults should guide ambiguous requests, not override clear requests like “shorten this”, “rewrite only this paragraph”, or “keep all details”

## 2026-03-13: Simplified optimization slice implemented

- Client-side routing now classifies requests into:
  - `selection_edit`
  - `document_transform`
  - `document_create`
- Routing is now driven by actual context instead of only the deep-mode toggle:
  - selection present => `selection_edit`
  - uploaded files or current-page content => `document_transform`
  - blank-page generation => `document_create`
- Explicit user instructions now influence length handling directly:
  - explicit compression requests map to `lengthPolicy=compress`
  - explicit "do not shorten" requests map back to `lengthPolicy=preserve`
- The client now sends route metadata through both standard and agent flows:
  - `intentRoute`
  - `scope`
  - `sourcePolicy`
  - `lengthPolicy`
  - `prioritizeUserInstructions`
- Standard creator mode now receives current page content for document-transform tasks instead of only append summaries, which closes one major source-context gap.
- Nest now resolves document strategy with request-specific overrides, so prompt guidance includes:
  - route type
  - source policy
  - length policy
  - explicit user-instruction priority
- Agent-service now accepts and persists the same route metadata in request + state.
- Agent graph no longer forces every deep-mode request through the full SOP:
  - `selection_edit` routes directly to `writer`
  - `document_transform` routes `router -> explorer -> writer`
  - only `document_create` keeps the full `explorer -> clarifier -> proposer -> planner -> outliner -> writer -> reviewer` flow
- Explorer now uses a deterministic source-first plan for document-transform tasks:
  - parse uploaded files if present
  - avoid unnecessary external-research planning
- Writer now receives explicit execution-intent instructions, including:
  - local edit must only return replacement text
  - document transform must treat source content as primary material
  - default preservation/compression rules must yield to explicit user requests
- Reviewer now applies lighter validation for `selection_edit` and adds a basic over-compression guard for `document_transform` when the user did not request summarization.
