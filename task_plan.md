# Task Plan: Redesign Docmost AI Create into a high-quality AI documentation assistant

## Goal
Diagnose why the current AI Create flow produces low-value document drafts, verify how system prompts/templates/tools actually behave in code, compare the design with current official best practices, implement the first practical quality upgrade, and deliver a tested blueprint for a production-grade AI documentation assistant.

## Current Phase
Complete

## Phases

### Phase 1: Local Diagnosis
- [x] Verify how global system prompt and template prompts are applied in standard mode
- [x] Verify how global system prompt and template prompts are applied in agent mode
- [x] Trace current file parsing, search, image, and document writeback capabilities
- [x] Identify why the model underuses editor-native structure and tools
- **Status:** complete

### Phase 2: External Best-Practice Research
- [x] Collect official guidance for prompt design, tool use, structured outputs, and evals
- [x] Collect official guidance for agent orchestration and human-in-the-loop document workflows
- [x] Collect official guidance for multimodal document parsing / search / extraction tools already adjacent to this stack
- **Status:** complete

### Phase 3: Target Architecture
- [x] Define the target pipeline for planning, evidence gathering, writing, reviewing, and applying docs
- [x] Separate prompt concerns from tool policy, output schema, and quality policy
- [x] Define how editor-native structures (table, callout, mermaid, code block, details, image) become first-class output targets
- **Status:** complete

### Phase 4: Implementation Roadmap
- [x] Propose phased changes with impact, complexity, and migration order
- [x] Recommend concrete libraries / APIs / components to reuse versus replace
- [x] Define evaluation gates for "high-quality document assistant" behavior
- **Status:** complete

### Phase 5: Delivery
- [x] Deliver diagnosis tied to current code facts
- [x] Deliver a practical best-practice blueprint and prioritized next steps
- [x] Include source links for web-derived guidance
- **Status:** complete

### Phase 6: Browser E2E Hardening
- [x] Extend the current browser smoke into a stricter regression scenario
- [x] Validate that structured AI output can be inserted or committed into the live page
- [x] Record the browser-level result in planning artifacts and git history
- **Status:** complete

## Key Questions
1. Why do system prompt and template prompt feel ineffective in the current product?
2. Why does the current writer mostly emit long markdown prose instead of richer document structures?
3. Which useful tools already exist in the codebase but are not actually orchestrated into the writing flow?
4. What is the best-practice architecture for an AI documentation assistant that can analyze source material, decide when to use images/tables/diagrams/code, and self-check quality?
5. Which improvements should be implemented first for the highest quality gain?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Reuse planning files for this redesign task | The work spans code analysis, official guidance, implementation, and testing |
| Start with code facts before recommendations | The redesign must explain the observed failures concretely |
| Implement the first quality upgrade instead of stopping at analysis | The user asked for a complete plan and actual delivery |
| Add a server-side internal bridge for page read / knowledge search / image upload | Agent tools must be executable at runtime, not only described in prompts |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| PowerShell rendering showed mojibake in several Chinese comments/strings | 1 | Interpreted behavior from code structure and cross-file consistency, then rewrote planning artifacts cleanly |
| New Jest spec pulled in an ESM-only dependency chain through `collaboration.util` | 1 | Mocked `jsonToMarkdown` in the controller spec to keep the test focused on controller behavior |
| PowerShell rejected `&&` in a combined validation command | 1 | Re-ran the compile and pytest commands separately |
| Standard creator browser E2E inserted `{\"content\": ...}` JSON fragments into the page instead of plain markdown | 1 | Traced it to `AiService.streamWithContext()` double-wrapping chunks, changed the service to emit raw text chunks, added a regression spec, and re-ran the stricter browser insert E2E successfully |

## Notes
- Focus stayed on the AI Creator / agent-service path, not the smaller slash-menu AI actions.
- Recommendations were grounded in the existing stack where possible: Docling, Firecrawl, Tavily, LangGraph, TipTap/Docmost editor-ext.
- This delivery includes code changes, focused tests, and updated planning artifacts, not only a proposal.
- Remaining implementation hardening is now focused on browser-level regression coverage rather than more architecture changes.
- As of 2026-03-13, the stricter browser insert E2E is passing locally and this phase is ready to be closed in git history.
- Follow-up analysis on 2026-03-13 focused specifically on three live product pain points: rigid global workflow routing, failed local/selection editing behavior, and document-content loss between upload/parsing and prompt execution.

## 2026-03-13 Simplified Optimization Plan

### Goal
Improve AI Creator without a rewrite so it better matches user intent, preserves uploaded/source content, supports true local edits, and avoids over-compressing source documents.

### Top-Level Principle
- User instructions have the highest priority.
- Routing defaults, prompt templates, source-preservation rules, and quality guards must follow the user's explicit request instead of overriding it.
- Default protections only apply when the user has not clearly specified the desired scope, compression level, or transformation style.
- Example:
  - if the user says "only fix formatting, do not shorten", the system must preserve length unless impossible
  - if the user says "compress this into a short summary", compression rules should allow aggressive trimming
  - if the user says "rewrite only the selected paragraph", local-edit routing must win over full-document planning

### Implementation Phases

#### Phase A: Intent Routing
- Add a small routing layer before execution.
- Route requests into:
  - `selection_edit`
  - `document_transform`
  - `document_create`
- Keep `agentMode` as an override/upgrade signal, not the only routing rule.
- **Status:** complete

#### Phase B: Local Edit Shortcut
- When the user has selected content and the request is an edit/rewrite/formatting task, skip `clarifier -> proposer -> planner -> outliner`.
- Reuse existing writer + commit replace path for direct in-place editing.
- Only escalate to the full agent flow when the user explicitly asks for research, outline, or full-document regeneration.
- **Status:** complete

#### Phase C: Source-First Document Transform
- For uploaded-document or current-page transform tasks, treat source material as primary context.
- Reuse richer parsing output where possible and prefer relevant source chunks over generic research context.
- Add simple task metadata:
  - `scope`
  - `source_policy`
  - `length_policy`
- **Status:** complete

#### Phase D: Lightweight Quality Guards
- Add minimal reviewer checks for:
  - missing required source coverage
  - suspicious over-compression
  - accidental full-document rewrite during selection edits
- Reviewer checks must treat explicit user instructions as the comparison baseline, not generic defaults.
- Fail soft by keeping the draft in chat and retrying once rather than silently committing weak output.
- **Status:** complete

#### Phase E: Regression Validation
- Add focused scenarios for:
  - selection-only local edit
  - uploaded document format optimization
  - source-preserving rewrite without major content loss
- Roll out behind a feature flag or narrow routing switch first.
- **Status:** complete

### Acceptance Criteria
1. Selection edits no longer trigger outline/proposal flow by default.
2. Uploaded-document optimization keeps source structure and does not behave like a blank-page rewrite.
3. “Optimize/format this document” does not materially over-trim content unless the user explicitly requests compression.
4. Existing create-from-scratch scenarios remain functional.
5. When user instructions conflict with defaults, the system follows the user instruction.
