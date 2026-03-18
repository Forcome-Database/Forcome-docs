# Reference-First Agent Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smallest reliable behavior change that makes AI Creator read required sources first, stop on required-evidence failure, and avoid unnecessary clarification before evidence gathering.

**Architecture:** Add one authoritative evidence-preflight layer, unify URLs/uploaded documents/uploaded images/page context as evidence items, enforce a hard runtime gate before downstream generation, and expose only minimal user-visible states. Do not solve proposal/outline/reviewer sophistication in this phase.

**Tech Stack:** React/TypeScript client, NestJS server, Python/FastAPI agent-service, LangGraph, Jest/TSX tests, Pytest.

---

## File Structure

### Server authority

- Create: `apps/server/src/ee/ai/evidence-preflight.ts`
  - Extract URLs, classify required evidence, derive whether search is required, and normalize uploaded-source requirements.
- Create: `apps/server/src/ee/ai/evidence-preflight.spec.ts`
  - Cover URL extraction, uploaded-document/image requirements, and search-required detection.
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
  - Use server-side evidence preflight and forward the normalized evidence set.
- Modify: `apps/server/src/ee/ai/document-strategy.ts`
  - Add only the minimum route/policy expansion needed for evidence-first execution.

### Client transport and UX

- Modify: `apps/client/src/ee/ai/services/agent-service.ts`
  - Forward raw upload/page signals and accept blocked events.
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
  - Normalize blocked events.
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
  - Cover blocked-event normalization.
- Modify: `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
  - Stop on blocked, prevent auto-progression, and show the failure.
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
  - Show only minimal states.
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
  - Render blocked/read/search states clearly.

### Agent runtime

- Modify: `agent-service/app/schemas/request.py`
  - Accept a minimal evidence set from the server.
- Create: `agent-service/app/agent/evidence.py`
  - Define minimal evidence-item helpers.
- Modify: `agent-service/app/agent/state.py`
  - Add evidence items and blocking reason.
- Modify: `agent-service/app/main.py`
  - Seed the initial evidence state.
- Create: `agent-service/app/agent/nodes/evidence_acquirer.py`
  - Read URLs, parse uploaded documents, understand uploaded images, read page context, run required search.
- Create: `agent-service/app/agent/nodes/evidence_gate.py`
  - Block if any required evidence failed/timed out.
- Modify: `agent-service/app/agent/graph.py`
  - Run evidence acquisition/gate before any user-visible generation step.
- Modify: `agent-service/app/agent/nodes/clarifier.py`
  - Treat clarification as a fallback only after evidence gathering.

### Tests

- Create: `agent-service/tests/test_evidence_preflight_flow.py`
  - Core evidence-first runtime cases.
- Create or modify: `agent-service/tests/browser_ai_creator_reference_first.py`
  - End-to-end checks for read/search-before-write and fail-stop behavior.

## Chunk 1: Authoritative Evidence Preflight

### Task 1: Build one authoritative server-side evidence preflight

**Files:**
- Create: `apps/server/src/ee/ai/evidence-preflight.ts`
- Test: `apps/server/src/ee/ai/evidence-preflight.spec.ts`
- Modify: `apps/server/src/ee/ai/document-strategy.ts`

- [ ] **Step 1: Write failing tests for evidence derivation**

```ts
it("marks a referenced URL as required evidence", () => {
  const result = buildEvidencePreflight({
    prompt: "参照 https://example.com/docs 写一份指南",
    files: [],
    pageContent: "",
  });

  expect(result.items).toContainEqual(
    expect.objectContaining({
      kind: "reference_url",
      source: "https://example.com/docs",
      required: true,
    }),
  );
});

it("marks an uploaded PDF as required evidence when the task depends on it", () => {
  const result = buildEvidencePreflight({
    prompt: "根据我上传的 PDF 写操作手册",
    files: [{ filename: "manual.pdf", mimetype: "application/pdf" }],
    pageContent: "",
  });

  expect(result.items).toContainEqual(
    expect.objectContaining({
      kind: "uploaded_document",
      source: "manual.pdf",
      required: true,
    }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts`

Expected: FAIL because the preflight helper does not exist yet.

- [ ] **Step 3: Implement minimal evidence preflight**

```ts
type EvidenceKind =
  | "reference_url"
  | "uploaded_document"
  | "uploaded_image"
  | "page_context"
  | "web_search";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts`

Expected: PASS for URL, upload, and search-required classification.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ee/ai/evidence-preflight.ts apps/server/src/ee/ai/evidence-preflight.spec.ts apps/server/src/ee/ai/document-strategy.ts
git commit -m "feat: add authoritative AI evidence preflight"
```

### Task 2: Forward evidence preflight results to agent-service

**Files:**
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- Modify: `apps/client/src/ee/ai/services/agent-service.ts`
- Test: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

- [ ] **Step 1: Write a failing gateway test**

```ts
expect(agentBody).toMatchObject({
  evidence_items: expect.any(Array),
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

Expected: FAIL because the gateway does not yet send the evidence set.

- [ ] **Step 3: Implement forwarding with optional-field compatibility**

```ts
const evidence = buildEvidencePreflight(...);
const agentBody = {
  ...existing,
  evidence_items: evidence.items,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts src/ee/ai/evidence-preflight.spec.ts`

Expected: PASS with normalized evidence forwarded.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/client/src/ee/ai/services/agent-service.ts
git commit -m "feat: forward AI evidence set to agent runtime"
```

## Chunk 2: Runtime Hard Gate

### Task 3: Add minimal evidence state to agent-service

**Files:**
- Modify: `agent-service/app/schemas/request.py`
- Create: `agent-service/app/agent/evidence.py`
- Modify: `agent-service/app/agent/state.py`
- Modify: `agent-service/app/main.py`
- Test: `agent-service/tests/test_evidence_preflight_flow.py`

- [ ] **Step 1: Write failing pytest coverage for evidence items**

```python
def test_request_accepts_evidence_items():
    req = AgentRunRequest(
        user_message="use this",
        evidence_items=[
            {
                "kind": "reference_url",
                "source": "https://example.com",
                "required": True,
                "status": "pending",
                "purpose": "primary source",
            }
        ],
    )
    assert req.evidence_items[0].kind == "reference_url"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: FAIL because the request/state models do not support evidence items yet.

- [ ] **Step 3: Implement minimal evidence-item support**

```python
class EvidenceItem(TypedDict):
    kind: str
    source: str
    required: bool
    status: str
    purpose: str
    error: str | None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: PASS with seeded evidence state.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/schemas/request.py agent-service/app/agent/evidence.py agent-service/app/agent/state.py agent-service/app/main.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "feat: add minimal AI evidence state"
```

### Task 4: Acquire required evidence before any user-visible generation

**Files:**
- Create: `agent-service/app/agent/nodes/evidence_acquirer.py`
- Modify: `agent-service/app/agent/graph.py`
- Test: `agent-service/tests/test_evidence_preflight_flow.py`

- [ ] **Step 1: Write failing tests for required evidence acquisition**

```python
def test_reference_url_is_read_before_generation():
    ...

def test_uploaded_document_is_parsed_before_generation():
    ...

def test_uploaded_image_is_understood_before_generation():
    ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: FAIL because evidence acquisition does not exist yet.

- [ ] **Step 3: Implement deterministic evidence acquisition**

```python
if item["kind"] == "reference_url":
    ...
elif item["kind"] == "uploaded_document":
    ...
elif item["kind"] == "uploaded_image":
    ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: PASS with read/parse/vision-before-generation behavior.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/nodes/evidence_acquirer.py agent-service/app/agent/graph.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "feat: acquire required evidence before generation"
```

### Task 5: Add hard fail-stop gate

**Files:**
- Create: `agent-service/app/agent/nodes/evidence_gate.py`
- Modify: `agent-service/app/agent/graph.py`
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- Test: `agent-service/tests/test_evidence_preflight_flow.py`
- Test: `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **Step 1: Write failing tests for blocked behavior**

```python
def test_required_evidence_failure_blocks_before_write():
    ...

def test_required_evidence_timeout_blocks_before_write():
    ...
```

```ts
assert.deepEqual(normalizeAgentRunEvent({ type: "blocked", message: "fetch failed" }), {
  type: "blocked",
  message: "fetch failed",
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Run: `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`

Expected: FAIL because hard blocked behavior does not exist yet.

- [ ] **Step 3: Implement runtime blocked invariant**

```python
if any(item["required"] and item["status"] != "success" for item in evidence_items):
    return {"phase": "blocked", "blocked_reason": "..."}
```

- [ ] **Step 4: Ensure blocked reaches the client and stops the session**

```ts
case "blocked":
  setIsStreaming(false);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Run: `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`

Expected: PASS with hard stop semantics.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/agent/nodes/evidence_gate.py agent-service/app/agent/graph.py apps/client/src/ee/ai/services/ai-create-runner.utils.ts apps/client/src/ee/ai/hooks/use-ai-create-session.ts agent-service/tests/test_evidence_preflight_flow.py apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat: hard stop AI runs when required evidence fails"
```

## Chunk 3: Clarification as Fallback, Not Stage

### Task 6: Only ask after evidence when a concrete decision still blocks execution

**Files:**
- Modify: `agent-service/app/agent/nodes/clarifier.py`
- Test: `agent-service/tests/test_evidence_preflight_flow.py`

- [ ] **Step 1: Write failing tests**

```python
def test_clear_evidence_grounded_request_does_not_clarify():
    ...

def test_post_evidence_ambiguity_triggers_single_clarification():
    ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: FAIL because clarification is not yet constrained this way.

- [ ] **Step 3: Implement fallback-only clarification**

```python
if not missing_decision:
    return {"phase": "writer"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: PASS with no unnecessary questions before or after evidence.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/nodes/clarifier.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "feat: treat clarification as fallback after evidence"
```

## Chunk 4: Minimal UX and E2E

### Task 7: Reduce visible states to meaningful evidence-first feedback

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`

- [ ] **Step 1: Write a failing UI test or focused assertion**

```ts
expect(renderedText).toContain("reading sources");
expect(renderedText).not.toContain("proposal");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts`

Expected: FAIL because minimal state mapping does not exist yet.

- [ ] **Step 3: Implement minimal visible states**

```ts
const visibleStates = ["reading sources", "searching", "need clarification", "blocked", "writing"];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts`

Expected: PASS with low-ceremony state rendering.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts
git commit -m "feat: simplify AI creator visible run states"
```

### Task 8: Add end-to-end regressions for the real user pain

**Files:**
- Create or modify: `agent-service/tests/browser_ai_creator_reference_first.py`

- [ ] **Step 1: Write failing browser scenarios**

```python
def test_url_prompt_reads_before_write():
    ...

def test_required_fetch_failure_stops_without_draft():
    ...

def test_uploaded_pdf_is_parsed_before_write():
    ...

def test_uploaded_image_is_understood_before_write():
    ...
```

- [ ] **Step 2: Run browser tests to verify they fail**

Run: `python agent-service/tests/browser_ai_creator_reference_first.py`

Expected: FAIL because current runtime still allows premature generation.

- [ ] **Step 3: Implement only the minimal assertions needed**

```python
assert "reading sources" in steps_text
assert "writing" not in steps_text_before_successful_evidence
```

- [ ] **Step 4: Run browser and focused runtime tests**

Run: `python agent-service/tests/browser_ai_creator_reference_first.py`

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: PASS for read/search-before-write and fail-stop behavior.

- [ ] **Step 5: Commit**

```bash
git add agent-service/tests/browser_ai_creator_reference_first.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "test: add evidence-first AI creator regressions"
```

## Final Verification

- [ ] **Step 1: Run focused server tests**

Run: `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

Expected: PASS

- [ ] **Step 2: Run focused client tests**

Run: `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts`

Expected: PASS

- [ ] **Step 3: Run focused agent tests**

Run: `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

Expected: PASS

- [ ] **Step 4: Run browser regression**

Run: `python agent-service/tests/browser_ai_creator_reference_first.py`

Expected: PASS

- [ ] **Step 5: Update planning artifacts and commit the revised plan**

```bash
git add docs/superpowers/specs/2026-03-13-reference-first-agent-design.md docs/superpowers/plans/2026-03-13-reference-first-agent-implementation.md findings.md progress.md
git commit -m "docs: revise reference-first AI creator phase 1 plan"
```
