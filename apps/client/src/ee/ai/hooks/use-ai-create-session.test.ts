import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveApplyExpectedVersion,
  resolveAiCreateSubmitTransport,
  shouldPreparePendingChangesForCompletedRun,
} from "./use-ai-create-session";

test("shouldPreparePendingChangesForCompletedRun enables apply for completed document tasks without review", () => {
  assert.equal(
    shouldPreparePendingChangesForCompletedRun({
      autoInsert: false,
      content: "# Title\n\nUpdated body",
      insertMode: "overwrite",
      pendingReviewAccepted: false,
      sourceScope: "uploaded_document",
    }),
    true,
  );
});

test("shouldPreparePendingChangesForCompletedRun keeps selection rewrites on the inline path", () => {
  assert.equal(
    shouldPreparePendingChangesForCompletedRun({
      autoInsert: false,
      content: "Updated paragraph",
      insertMode: "replace",
      pendingReviewAccepted: false,
      sourceScope: "selection",
    }),
    false,
  );
});

test("resolveAiCreateSubmitTransport routes agent document tasks through the task shell", () => {
  assert.equal(
    resolveAiCreateSubmitTransport({
      effectiveMode: "agent",
      route: "document_transform",
    }),
    "document_task_shell",
  );
  assert.equal(
    resolveAiCreateSubmitTransport({
      effectiveMode: "agent",
      route: "document_create",
    }),
    "document_task_shell",
  );
});

test("resolveAiCreateSubmitTransport keeps selection rewrites on the dedicated inline path", () => {
  assert.equal(
    resolveAiCreateSubmitTransport({
      effectiveMode: "agent",
      route: "selection_edit",
    }),
    "inline_rewrite",
  );
});

test("resolveAiCreateSubmitTransport keeps standard mode on the legacy standard transport", () => {
  assert.equal(
    resolveAiCreateSubmitTransport({
      effectiveMode: "standard",
      route: "document_transform",
    }),
    "legacy_standard",
  );
});

test("resolveApplyExpectedVersion prefers the latest page timestamp when apply starts", () => {
  assert.equal(
    resolveApplyExpectedVersion(
      "2026-03-22T00:00:00.000Z",
      "2026-03-22T00:00:05.000Z",
    ),
    "2026-03-22T00:00:05.000Z",
  );
  assert.equal(
    resolveApplyExpectedVersion("2026-03-22T00:00:00.000Z", null),
    "2026-03-22T00:00:00.000Z",
  );
});
