import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiIntent } from "./ai-intent";

test("resolveAiIntent routes selection edits ahead of global creation", () => {
  const result = resolveAiIntent({
    prompt: "Please polish this paragraph but do not shorten it",
    selection: "Original selected paragraph",
    files: [],
    pageHasContent: true,
    agentMode: true,
  });

  assert.deepEqual(result, {
    route: "selection_edit",
    scope: "selection",
    sourcePolicy: "transform_source",
    lengthPolicy: "preserve",
    prioritizeUserInstructions: true,
    effectiveMode: "agent",
  });
});

test("resolveAiIntent treats uploaded files as source-first document transforms", () => {
  const result = resolveAiIntent({
    prompt: "Optimize the formatting of this uploaded document",
    selection: "",
    files: [new File(["content"], "spec.txt", { type: "text/plain" })],
    pageHasContent: false,
    agentMode: false,
  });

  assert.deepEqual(result, {
    route: "document_transform",
    scope: "uploaded_document",
    sourcePolicy: "preserve_source",
    lengthPolicy: "preserve",
    documentTask: {
      mode: "strict_preservation",
      sourceScope: "uploaded_document",
      taskSummarySource: "structured_summary",
      includeRawHistory: false,
      diff: {
        reviewMode: "diff_first",
        defaultGranularity: "block",
        supportedGranularity: ["block", "text"],
      },
      guardrails: {
        preserveMeaning: true,
        preserveImageTextCorrespondence: true,
      },
    },
    prioritizeUserInstructions: true,
    effectiveMode: "agent",
  });
});

test("resolveAiIntent keeps uploaded files as the primary source by default even when the current page has content", () => {
  const result = resolveAiIntent({
    prompt: "Optimize this uploaded document",
    selection: "",
    files: [new File(["content"], "spec.txt", { type: "text/plain" })],
    pageHasContent: true,
    agentMode: true,
  });

  assert.equal(result.route, "document_transform");
  assert.equal(result.scope, "uploaded_document");
  assert.equal(result.documentTask?.sourceScope, "uploaded_document");
});

test("resolveAiIntent only joins current-page context into uploaded transforms when the prompt explicitly asks for it", () => {
  const result = resolveAiIntent({
    prompt:
      "Use the uploaded document as the primary source and also incorporate the current page where it adds missing context",
    selection: "",
    files: [new File(["content"], "spec.txt", { type: "text/plain" })],
    pageHasContent: true,
    agentMode: false,
  });

  assert.equal(result.route, "document_transform");
  assert.equal(result.scope, "uploaded_plus_current_page");
  assert.equal(result.documentTask?.sourceScope, "uploaded_plus_current_page");
});

test("resolveAiIntent does not join current-page context when the prompt explicitly excludes it", () => {
  const result = resolveAiIntent({
    prompt:
      "Use the uploaded document as the only source. Do not use the current page unless explicitly required.",
    selection: "",
    files: [new File(["content"], "spec.txt", { type: "text/plain" })],
    pageHasContent: true,
    agentMode: true,
  });

  assert.equal(result.route, "document_transform");
  assert.equal(result.scope, "uploaded_document");
  assert.equal(result.documentTask?.sourceScope, "uploaded_document");
});

test("resolveAiIntent keeps relaxed optimization inside the document-transform contract instead of treating it as unrestricted drafting", () => {
  const result = resolveAiIntent({
    prompt:
      "Reorganize and summarize this uploaded guide into a cleaner structure without losing meaning or image context",
    selection: "",
    files: [new File(["content"], "guide.md", { type: "text/markdown" })],
    pageHasContent: false,
    agentMode: true,
  });

  assert.equal(result.route, "document_transform");
  assert.equal(result.documentTask?.mode, "relaxed_optimization");
  assert.deepEqual(result.documentTask?.guardrails, {
    preserveMeaning: true,
    preserveImageTextCorrespondence: true,
  });
  assert.equal(result.documentTask?.taskSummarySource, "structured_summary");
  assert.equal(result.documentTask?.includeRawHistory, false);
});

test("resolveAiIntent allows explicit compression requests to override default length preservation", () => {
  const result = resolveAiIntent({
    prompt: "Summarize this page into a short brief",
    selection: "",
    files: [],
    pageHasContent: true,
    agentMode: true,
  });

  assert.equal(result.route, "document_transform");
  assert.equal(result.lengthPolicy, "compress");
});

test("resolveAiIntent falls back to document creation on blank pages", () => {
  const result = resolveAiIntent({
    prompt: "Draft a new requirements document",
    selection: "",
    files: [],
    pageHasContent: false,
    agentMode: false,
  });

  assert.deepEqual(result, {
    route: "document_create",
    scope: "blank_page",
    sourcePolicy: "create_new",
    lengthPolicy: "preserve",
    prioritizeUserInstructions: true,
    effectiveMode: "standard",
  });
});

test("resolveAiIntent treats referenced URLs as source-first transforms even on blank pages", () => {
  const result = resolveAiIntent({
    prompt: "https://help.router-for.me/cn/introduction/quick-start.html mirror this document",
    selection: "",
    files: [],
    pageHasContent: false,
    agentMode: true,
  });

  assert.deepEqual(result, {
    route: "document_transform",
    scope: "blank_page",
    sourcePolicy: "transform_source",
    lengthPolicy: "preserve",
    prioritizeUserInstructions: true,
    effectiveMode: "agent",
  });
});

test("resolveAiIntent keeps freshness-only blank page prompts on document_create so evidence gating stays runtime-owned", () => {
  const result = resolveAiIntent({
    prompt: "Write the latest overview of AI coding agents for an internal memo",
    selection: "",
    files: [],
    pageHasContent: false,
    agentMode: true,
  });

  assert.deepEqual(result, {
    route: "document_create",
    scope: "blank_page",
    sourcePolicy: "create_new",
    lengthPolicy: "preserve",
    prioritizeUserInstructions: true,
    effectiveMode: "agent",
  });
});
