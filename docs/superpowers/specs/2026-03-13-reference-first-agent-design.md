# Reference-First Agent Design

**Status:** Revised after critical review

**Problem Statement**

The current Docmost AI Creator fails in the exact place users expect competence: when a request includes an external link, uploaded document, uploaded image, or otherwise clearly depends on evidence, the system may still jump into clarification, proposal, outline, or drafting before it has actually read the source material.

The product therefore feels like a workflow engine performing ceremony rather than an agent doing the obvious work first.

The fix is not “better prompts” and not “more stages.” The fix is a small set of hard execution invariants:

- required evidence must be acquired before generation
- required evidence failure must stop execution
- clarification must be a fallback, not a stage
- visible progress must reflect real actions, not ritual

## Goals

- Read required sources before drafting.
- Search before drafting when the task semantically requires external evidence.
- Stop and explain when required evidence cannot be retrieved or parsed.
- Treat uploaded files, uploaded images, external links, and current page context as one unified evidence system.
- Ask clarifying questions only when a concrete unresolved decision remains after evidence gathering.
- Make the product feel closer to Codex or Claude Code:
  - do the obvious work first
  - gather evidence before talking
  - stop when blocked
  - avoid user-facing workflow theater

## Non-Goals

- Rebuilding the entire AI Creator graph in one phase.
- Reworking the full UI state model.
- Making proposal/outline/reviewer behavior perfect in the same change.
- Creating a large multi-layer evidence contract before proving the core behavior.

## Core Design Decision

Do **not** solve this as a large stage redesign first.

Solve it as a **runtime invariant**:

> If required evidence has not succeeded, the system cannot proceed to any user-facing drafting or planning output.

That is the primary behavior change. Everything else is secondary.

## Unified Evidence Model

All source-like inputs should be treated as evidence sources of the same class:

- `reference_url`
- `uploaded_document`
- `uploaded_image`
- `page_context`
- `web_search`

Each evidence source needs only a minimal shared state:

```ts
type EvidenceItem = {
  kind: "reference_url" | "uploaded_document" | "uploaded_image" | "page_context" | "web_search";
  source: string;
  required: boolean;
  status: "pending" | "success" | "failed" | "timed_out";
  purpose: string;
  error?: string;
};
```

This should be the only evidence truth the runtime depends on.

## Evidence Rules

### 1. External links

If the user includes one or more external URLs and the request says or implies “refer to this,” “rewrite based on this,” “summarize this,” “imitate this,” or otherwise anchors the task to the link, that URL becomes required evidence.

The system must read it before drafting.

### 2. Uploaded documents

If the user uploads a document and the task depends on that document, it becomes required evidence.

Examples:
- “Based on this PDF, write an onboarding guide”
- “Reorganize this Word document into a tutorial”

Document parsing failure must block the run if the uploaded document is the primary source.

### 3. Uploaded images

If the task depends on image contents, the image becomes required evidence and must go through visual understanding first.

Examples:
- “Write steps based on this screenshot”
- “Explain this architecture image”

Image understanding failure must block the run if the image is needed to complete the task safely.

### 4. Current page context

If the user asks to continue, transform, or build on the current page, the current page is evidence.

If page context cannot be loaded and it is required for the request, the run must stop.

### 5. Search

Search is required when the task depends on external facts not already supplied by the user or retrieved from provided evidence.

Examples:
- freshness-sensitive requests
- “compare with current best practices”
- “what changed recently”
- tasks that require outside factual grounding

Search should not be triggered just because the request is broad. It should be triggered when the task cannot be completed responsibly from existing evidence.

## Upload Handling

Uploaded files and images should not be treated as miscellaneous attachments. They should enter the same evidence-first path as URLs.

### Uploaded document handling

1. Parse first.
2. Preserve structure where possible.
3. Use parsed content as primary evidence before asking questions.
4. Only ask clarification if the parsed source still leaves a real decision unresolved.

### Uploaded image handling

1. Run vision first.
2. Extract task-relevant content:
   - UI labels
   - steps
   - warnings
   - relationships
   - diagram structure
3. Use that evidence before asking questions or drafting.

### Mixed evidence input

If the user provides multiple evidence sources together, they form one evidence set.

Example:
- uploaded PDF
- screenshot
- external README URL

The system should:
1. collect all required evidence
2. process each required source
3. stop if any required source fails
4. only then decide whether clarification is necessary

## Clarification Policy

Clarification is not a stage. It is a fallback.

The system should ask a question only when:

- evidence gathering succeeded or exhausted available obvious actions
- execution is blocked by a specific unresolved decision
- the system can name exactly what decision is missing

Examples of valid clarification after evidence:

- target audience is unknown and materially changes the output
- the user did not specify whether to preserve detail or compress aggressively
- multiple plausible transformations remain after reading the source

Invalid clarification:

- asking style questions before reading the source
- asking for information that can be extracted automatically
- asking because the system skipped obvious search/read actions

## Runtime Hard Gate

This is the most important design rule.

Before any clarify/propose/outline/write path can emit user-visible output, the runtime must check:

- do all required evidence items have `status == success`?

If no:

- emit blocked state
- explain which evidence failed and why
- stop execution
- do not allow downstream generation

This must be enforced in execution code, not just prompts and not just reviewer logic.

## Visible Product States

Keep visible states minimal and useful:

- `reading sources`
- `searching`
- `need clarification`
- `blocked`
- `writing`

Do not expose a richer stage ladder unless the user gains something actionable from it.

## What This Phase Deliberately Does Not Try to Perfect

These are important, but secondary:

- proposal suppression logic
- outline suppression logic
- reviewer sophistication
- broad observability dashboards
- large typed contracts across every boundary

They can improve later. They are not the core fix.

## Success Criteria

The user experience must satisfy these end-to-end rules:

1. If a prompt includes a required URL, the system reads it before writing.
2. If a task clearly requires search, the system searches before writing.
3. If a required link/doc/image/page/search step fails, the system stops and explains the failure.
4. If enough evidence exists, the system does not ask unnecessary questions.
5. If evidence is insufficient but the missing decision is specific, the system asks one meaningful clarification question.

## Phase 1 Scope

Phase 1 should implement only:

- single authoritative evidence derivation
- unified evidence handling for URLs, uploaded documents, uploaded images, and page context
- hard execution gate for required evidence
- fail-stop behavior
- minimal visible states
- end-to-end tests for the core bad behaviors

## Phase 2 Candidates

Only after Phase 1 works reliably:

- make proposal and outline truly opportunistic
- add richer evidence-to-output reviewer checks
- add stronger observability and rollout controls
- add recovery loops for supplementary research when first-pass evidence proves insufficient

## Expected Product Behavior

Given:

`参照这个 README 写一份安装指南 https://...`

the system should:

1. detect the URL as required evidence
2. read it first
3. stop immediately if the read fails
4. write directly if the task is now clear
5. ask a focused question only if a concrete unresolved decision remains

Given:

“根据我上传的 PDF 和这张截图，写一份操作手册”

the system should:

1. parse the PDF
2. understand the screenshot
3. block if either required source fails
4. use the gathered evidence before asking anything
5. only ask if audience/format/detail expectations still cannot be inferred

That is the behavior shift required to make the product feel like an evidence-first agent instead of a staged workflow engine.
