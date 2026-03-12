import assert from "node:assert/strict";
import test from "node:test";
import {
  aiCreateSessionReducer,
  createInitialAiCreateSessionState,
} from "./ai-create-session.reducer";

test("run_started resets streaming artifacts and clears thread for new runs", () => {
  const initial = {
    ...createInitialAiCreateSessionState(),
    threadId: "thread-1",
    taskId: "task-1",
    accumulatedContent: "draft",
    mdBuffer: "buffer",
    awaitInput: { phase: "outline" as const, data: { outline: "A" } },
  };

  const next = aiCreateSessionReducer(initial, {
    type: "run_started",
    mode: "agent",
    insertMode: "overwrite",
    selectionSnapshot: null,
    startedAt: 42,
    threadId: null,
  });

  assert.deepEqual(next, {
    status: "running",
    mode: "agent",
    insertMode: "overwrite",
    threadId: null,
    taskId: null,
    accumulatedContent: "",
    mdBuffer: "",
    startedAt: 42,
    selectionSnapshot: null,
    awaitInput: null,
    error: null,
  });
});

test("run_started can preserve thread id for resume flows", () => {
  const next = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "run_started",
    mode: "agent",
    insertMode: "append",
    selectionSnapshot: null,
    startedAt: 99,
    threadId: "thread-2",
  });

  assert.equal(next.threadId, "thread-2");
  assert.equal(next.insertMode, "append");
  assert.equal(next.status, "running");
});

test("await_input moves session into awaiting_input and clears task ownership", () => {
  const initial = {
    ...createInitialAiCreateSessionState(),
    status: "running" as const,
    taskId: "task-2",
  };

  const next = aiCreateSessionReducer(initial, {
    type: "await_input",
    phase: "clarify",
    data: { questions: ["Audience?"] },
  });

  assert.equal(next.status, "awaiting_input");
  assert.equal(next.taskId, null);
  assert.deepEqual(next.awaitInput, {
    phase: "clarify",
    data: { questions: ["Audience?"] },
  });
});

test("done and cancelled clear pending interrupt state", () => {
  const awaitingInput = {
    ...createInitialAiCreateSessionState(),
    status: "awaiting_input" as const,
    awaitInput: { phase: "outline" as const, data: { outline: "A" } },
    taskId: "task-3",
  };

  const done = aiCreateSessionReducer(awaitingInput, { type: "done" });
  assert.equal(done.status, "completed");
  assert.equal(done.taskId, null);
  assert.equal(done.awaitInput, null);

  const cancelled = aiCreateSessionReducer(awaitingInput, { type: "cancelled" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.taskId, null);
  assert.equal(cancelled.awaitInput, null);
});
