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
    prioritizeUserInstructions: true,
    effectiveMode: "standard",
  });
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
    prompt: "https://help.router-for.me/cn/introduction/quick-start.html 请复刻这个文档内容",
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
