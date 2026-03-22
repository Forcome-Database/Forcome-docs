import assert from "node:assert/strict";
import test from "node:test";
import { createInitialAiCreateSessionState } from "../components/ai-creator/ai-create-session.reducer";
import { deriveTaskApplyRollbackState } from "./use-task-apply-rollback";

test("deriveTaskApplyRollbackState enables apply only when pending changes exist", () => {
  const base = createInitialAiCreateSessionState();

  assert.deepEqual(deriveTaskApplyRollbackState(base), {
    canApply: false,
    canRollback: false,
  });

  const withPending = {
    ...base,
    documentTask: {
      ...base.documentTask,
      pendingChangeSet: [
        {
          changeId: "change-1",
          label: "Apply reviewed article",
          content: "# Draft",
          insertMode: "overwrite",
          selectionSnapshot: null,
        },
      ],
    },
  };

  assert.deepEqual(deriveTaskApplyRollbackState(withPending as any), {
    canApply: true,
    canRollback: false,
  });
});

test("deriveTaskApplyRollbackState enables rollback when a rollback snapshot exists", () => {
  const base = createInitialAiCreateSessionState();
  const withRollback = {
    ...base,
    status: "running",
    documentTask: {
      ...base.documentTask,
      rollbackSnapshot: {
        title: "Original title",
        bodyJson: '{"type":"doc","content":[]}',
      },
    },
  };

  assert.deepEqual(deriveTaskApplyRollbackState(withRollback as any), {
    canApply: false,
    canRollback: true,
  });
});
