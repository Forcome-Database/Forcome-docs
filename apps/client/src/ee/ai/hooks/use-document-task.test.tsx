import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialDocumentTaskState,
  deriveDocumentTaskState,
} from "./use-document-task";

test("deriveDocumentTaskState uses structured summaries and excludes raw message history", () => {
  const state = deriveDocumentTaskState({
    status: "awaiting_input",
    brief: {
      audience: "engineers",
      goal: "Preserve structure while improving clarity",
      target_length: 1200,
      length_tolerance: 0.1,
      style: "technical",
      tone: "direct",
      structure_strategy: "ai_recommend",
      image_strategy: "none",
      constraints: [],
    },
    blueprint: null,
    reviewReport: null,
    draftSections: [],
    evidenceSummary: null,
    rawMessages: [
      { role: "user", content: "old chat state should not flow into document task" },
    ],
  });

  assert.equal(state.taskSummary.summarySource, "structured_summary");
  assert.equal(state.taskSummary.includeRawHistory, false);
  assert.equal(
    state.taskSummary.summary,
    "Preserve structure while improving clarity",
  );
  assert.equal("rawMessages" in state.taskSummary, false);
});

test("createInitialDocumentTaskState starts with task-first empty state", () => {
  const state = createInitialDocumentTaskState();

  assert.equal(state.status, "idle");
  assert.equal(state.taskSummary.summarySource, "structured_summary");
  assert.equal(state.taskSummary.includeRawHistory, false);
  assert.equal(state.sourceScope, "current_page");
  assert.equal(state.mode, "strict_preservation");
  assert.equal(state.deepCollaborationEnabled, true);
  assert.deepEqual(state.diffSet, []);
  assert.deepEqual(state.pendingChangeSet, []);
});
