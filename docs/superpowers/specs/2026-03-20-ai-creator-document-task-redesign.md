# AI Creator Document-Task Redesign

> Date: 2026-03-20
> Status: Drafted, pending user review
> Priority: document transform > selection rewrite > blank-page drafting
> Decision: replace chat-first AI Creator with document-task-first architecture

## 1. Executive Summary

The current AI Creator is not failing because the models are too weak. It is failing because three fundamentally different jobs are forced into one shared chat/workbench shell:

1. Selection rewrite
2. Document transform
3. Blank-page drafting

That coupling causes the visible problems:

- UI overload
- selection rewrite conflicting with previous conversation context
- document optimization behaving like full redrafting
- section-by-section writing producing coherence drift
- source images and structure being lost during repeated optimization

The redesign should not hide chat. It should remove chat as the default product metaphor.

The new default should be:

- inline rewrite for local selection tasks
- a right-side document operation center for document-level tasks
- an expert collaboration layer that opens only when workflow automation is insufficient

## 2. Critical Judgment

### 2.1 What is wrong with the current design

The current design is not the best solution for the product's primary job.

The core problem is that it models document operations as message history. That is the wrong abstraction. A document task should be represented as:

- intent
- source scope
- preservation mode
- structured summary
- plan
- diff set
- pending accepted changes
- apply and rollback

not as:

- user messages
- assistant messages
- activity log
- long-lived conversation context

### 2.2 Why the current section-writer default is wrong

Section-by-section writing should not remain the default path for document optimization.

For strict-preservation document transform, the right primitive is not:

- brief
- blueprint
- section writer
- merge

The right primitive is:

- parse structure and assets
- generate block or asset aware changes
- review diffs
- apply accepted changes safely

Section writing can remain useful, but only for:

- blank-page drafting
- multi-document synthesis
- relaxed large-scope rewrite

### 2.3 Why uploaded documents should use MinerU-first

For uploaded PDF and DOC workflows, MinerU-first with Docling fallback is the right parsing strategy.

Reason:

- the highest-sensitivity failure is broken image-to-text correspondence
- strict preservation requires layout blocks, image blocks, heading structure, and local surrounding text
- plain text extraction is not sufficient

Therefore:

- uploaded document optimize: MinerU-first, Docling fallback
- current page optimize: editor block tree and page structure first, not MinerU

## 3. Confirmed Product Requirements

### 3.1 Priority and scope

- All three scenarios remain in scope
- Priority order is:
  1. document transform
  2. selection rewrite
  3. blank-page drafting

### 3.2 Document transform requirements

- Support two modes:
  - strict preservation
  - relaxed optimization
- Default mode is strict preservation
- Strict preservation should preserve structure, images, tables, and code blocks as much as possible
- Relaxed optimization may reorder structure, but must not break meaning or image-text correspondence
- Uploaded-source optimization and current-page optimization share one main product flow
- Uploaded sources are the default primary input when files are provided
- Current page only participates in uploaded-source optimization when explicitly requested
- Current-page optimization is lighter than uploaded-source optimization, but it must still preserve at least images and tables

### 3.3 Review and apply requirements

- Default review mode is diff-first
- Review granularity is mixed:
  - block-level by default
  - expandable fine-grained text diffs inside text blocks
- Accept and reject actions should build a pending change set
- Final apply should be explicit
- Final apply writes to the live document and must automatically create a rollback snapshot

### 3.4 Selection rewrite requirements

- Two interaction modes may coexist:
  - inline editor-local preview flow
  - panel-assisted flow when needed
- Default selection rewrite remains inline
- Selection rewrite must not inherit raw chat history
- Selection rewrite may read:
  - selection snapshot
  - local context
  - structured current document task summary
- If a document task is active, ad hoc selection rewrite must still run as an isolated temporary operation

### 3.5 Collaboration requirements

- The right-side panel should default to document-level tasks only
- The panel is not a general chat interface
- The panel should behave as a document operation center by default
- Complex tasks may auto-upgrade into an expert collaboration layer
- The user must be able to turn deep collaboration off
- The expert collaboration layer lives inside the right-side panel, not as a separate page
- The collaboration layer must output structured decisions, not free-form history

### 3.6 Blank-page drafting requirements

- Small drafting tasks may draft directly
- Larger drafting tasks must confirm brief or outline first
- Blank-page drafting is lower priority than document transform and selection rewrite

## 4. Product Principle

AI creation is no longer chat-centered. It is document-task-centered.

The product principle is:

> Default to preservation-first, reviewable, rollback-safe workflows that act on the document. Only upgrade to controlled collaboration when workflows are insufficient.

## 5. Information Architecture

### 5.1 Layer 1: Inline Rewrite

Purpose:

- local selection tasks only

Primary UX:

- replace
- insert below
- retry
- discard

Properties:

- short-lived
- no long-lived task history
- no dependence on main panel message flow

### 5.2 Layer 2: Document Operation Center

Purpose:

- current-page optimize
- uploaded-document optimize
- blank-page drafting

Default shape:

- task header
- source scope
- preservation mode toggle
- structured task summary
- plan preview when needed
- diff review
- pending change set
- apply and rollback controls

This layer is not a chat UI.

### 5.3 Layer 3: Expert Collaboration Layer

Purpose:

- clarify complex constraints
- confirm high-impact plans
- handle preservation downgrade requests
- resolve multi-document conflicts
- support complex synthesis tasks

It should appear only when needed, inside the document operation center, and should collapse back into structured task state after decisions are made.

## 6. State Model

### 6.1 Core object: DocumentTask

Recommended fields:

- `taskId`
- `taskType`
- `sourceScope`
- `mode`
- `complexity`
- `status`
- `taskSummary`
- `confirmedDecisions`
- `plan`
- `diffSet`
- `pendingChangeSet`
- `snapshot`
- `rollbackRef`
- `riskFlags`

### 6.2 InlineRewriteTask

Recommended fields:

- `selectionSnapshot`
- `localContext`
- `taskSummaryRef`
- `candidateResult`
- `actionType`
- `status`

This object must be independent from `DocumentTask`.

### 6.3 ExpertCollabState

Recommended fields:

- `reason`
- `question`
- `options`
- `recommendedOption`
- `confirmedDecision`

This is a sub-state of `DocumentTask`, not a top-level message stream.

## 7. Backend Engine Split

### 7.1 Inline Rewrite Engine

Used for:

- selection rewrite
- local transformation
- fast inline operations

Behavior:

- single-step workflow
- local context only
- candidate result only

This should stay separate from the document task engine.

### 7.2 Document Task Engine

This is the main engine for document-level work.

It should internally support two distinct strategies.

#### A. Preservation Patch Flow

Used for:

- strict-preservation document optimization
- current-page optimization
- uploaded-document optimization

Behavior:

- parse structure and assets
- map blocks and source assets
- generate structured diffs
- allow review
- build pending accepted set
- apply with rollback

This flow must be the default for document transform.

#### B. Draft and Synthesis Flow

Used for:

- blank-page drafting
- multi-document synthesis
- relaxed large-scope rewrite

Behavior:

- brief
- outline or plan
- draft generation
- evaluator and optimizer loop
- review

This is where section writing may still exist.

### 7.3 Expert Collaboration as a sub-layer

The collaboration layer is not a third engine. It is a controlled decision stage used by the document task engine when:

- impact is high
- the plan needs confirmation
- preservation cannot be guaranteed
- multiple source documents conflict

## 8. Parsing Strategy

### 8.1 Uploaded documents

Use:

- MinerU-first
- Docling fallback

The parser must preserve:

- heading hierarchy
- text blocks
- image blocks
- table blocks
- code or structured blocks when possible

### 8.2 Current page

Use:

- editor block tree
- ProseMirror or TipTap structure
- existing page asset references

Do not route current-page optimization through MinerU.

## 9. Default Safety Rules

### 9.1 Images

Strict preservation:

- if image placement is uncertain, keep the original image in the original position

Relaxed optimization:

- prefer the original location
- suggest relocation only when the current placement is clearly unsuitable

### 9.2 Tables, code blocks, Mermaid

Strict preservation:

- if safe transformation is not possible, keep these blocks unchanged and optimize only surrounding content

### 9.3 Mode downgrade

If strict preservation cannot be maintained:

- do not silently downgrade
- request explicit user confirmation before switching to relaxed optimization

## 10. API Direction

The new contract should revolve around document tasks and change sets, not raw assistant messages.

Recommended endpoint families:

- `POST /api/ai/inline/rewrite`
- `POST /api/ai/document-tasks`
- `POST /api/ai/document-tasks/:taskId/plan`
- `POST /api/ai/document-tasks/:taskId/diff`
- `POST /api/ai/document-tasks/:taskId/review`
- `POST /api/ai/document-tasks/:taskId/apply`
- `POST /api/ai/document-tasks/:taskId/rollback`
- `POST /api/ai/document-tasks/:taskId/collab`

The dominant payloads should be:

- `taskSummary`
- `confirmedDecisions`
- `plan`
- `diffSet`
- `pendingChangeSet`
- `assetImpact`
- `riskFlags`
- `rollbackRef`

not:

- raw message history
- merged markdown as the only output

## 11. Keep, Reposition, Retire

### 11.1 Keep

- inline AI menu capabilities
- SSE and session infrastructure
- MinerU-first parsing direction
- rollback and conflict-recovery concepts

### 11.2 Reposition

- brief
- blueprint
- review
- evaluate
- fix tools

These should serve synthesis and collaboration flows, not be the default center of document optimization.

### 11.3 Retire as the default model

- current AI Creator workbench shell
- document tree plus live draft plus activity log as primary layout
- document optimization defaulting to section writer and merge
- chat history as the primary task state model

## 12. Migration Order

### Phase 1: front-end cutover

- replace the current workbench UI
- introduce the three-layer product model
- isolate selection rewrite from document task state

### Phase 2: task-state cutover

- introduce `DocumentTask`
- replace message-first session state with task-first state

### Phase 3: API shell cutover

- add document-task endpoints
- keep existing infrastructure behind adapters if needed

### Phase 4: optimization engine cutover

- make preservation patch flow the default for document transform
- keep section-based generation only for synthesis scenarios

### Phase 5: legacy cleanup

- retire the old AI Creator workbench shell
- remove legacy creator entry roles
- delete message glue that is no longer part of the main model

## 13. Final Recommendation

The recommended redesign is:

- not chat-hidden
- not chat-reskinned
- not section-writer-first

It is:

- inline rewrite for local work
- document-task-first operation center for document-level work
- controlled expert collaboration only when workflow automation is insufficient

This is the most defensible path for the product's actual priority:

- preservation-first document optimization with reviewable, rollback-safe application.
