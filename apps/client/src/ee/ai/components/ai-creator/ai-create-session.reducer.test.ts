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
    awaitInput: {
      phase: "brief" as const,
      data: {
        type: "brief" as const,
        brief: {
          audience: "engineers",
          goal: "Explain the system",
          target_length: 1200,
          length_tolerance: 0.1,
          style: "technical",
          tone: "professional",
          structure_strategy: "ai_recommend" as const,
          image_strategy: "none" as const,
          constraints: [],
        },
      },
    },
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
    block: null,
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
    phase: "review",
    data: {
      type: "review" as const,
      report: {
        overall_score: 82,
        length_compliance: 0.96,
        asset_reuse_rate: 0.5,
        issues: [],
        auto_fixed_count: 1,
        user_decision_needed: [],
      },
    },
  });

  assert.equal(next.status, "awaiting_input");
  assert.equal(next.taskId, null);
  assert.deepEqual(next.awaitInput, {
    phase: "review",
    data: {
      type: "review" as const,
      report: {
        overall_score: 82,
        length_compliance: 0.96,
        asset_reuse_rate: 0.5,
        issues: [],
        auto_fixed_count: 1,
        user_decision_needed: [],
      },
    },
  });
});

test("done and cancelled clear pending interrupt state", () => {
  const awaitingInput = {
    ...createInitialAiCreateSessionState(),
    status: "awaiting_input" as const,
    awaitInput: {
      phase: "blueprint" as const,
      data: {
        type: "blueprint" as const,
        blueprint: {
          title: "Doc",
          sections: [],
          total_word_budget: 1200,
          style_guide: "Technical and direct",
          visual_plan_summary: "No visuals",
        },
      },
    },
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

test("blocked keeps the session recoverable without turning it into an error", () => {
  const running = {
    ...createInitialAiCreateSessionState(),
    status: "running" as const,
    taskId: "task-9",
  };

  const blocked = aiCreateSessionReducer(running, {
    type: "blocked",
    block: {
      kind: "evidence",
      message: "Source page could not be read",
      requiredAction: "Retry or remove the source",
      allowedResolutions: ["retry", "remove_source"],
    },
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.taskId, null);
  assert.equal(blocked.error, null);
  assert.deepEqual(blocked.block, {
    kind: "evidence",
    message: "Source page could not be read",
    requiredAction: "Retry or remove the source",
    allowedResolutions: ["retry", "remove_source"],
  });
});

test("hydrate restores awaiting_input state and current draft markdown", () => {
  const next = aiCreateSessionReducer(
    createInitialAiCreateSessionState(),
    {
      type: "hydrate",
      threadId: "session-42",
      taskId: null,
      status: "awaiting_input",
      draftMarkdown: "# Draft\n\nBody",
      awaitInput: {
        phase: "blueprint" as const,
        data: {
          type: "blueprint" as const,
          blueprint: {
            title: "Recovered blueprint",
            sections: [],
            total_word_budget: 1800,
            style_guide: "Direct",
            visual_plan_summary: "No visuals",
          },
        },
      },
      block: null,
    } as any,
  );

  assert.equal(next.status, "awaiting_input");
  assert.equal(next.threadId, "session-42");
  assert.equal(next.error, null);
  assert.equal(next.accumulatedContent, "# Draft\n\nBody");
  assert.equal(next.mdBuffer, "# Draft\n\nBody");
  assert.deepEqual(next.awaitInput, {
    phase: "blueprint",
    data: {
      type: "blueprint" as const,
      blueprint: {
        title: "Recovered blueprint",
        sections: [],
        total_word_budget: 1800,
        style_guide: "Direct",
        visual_plan_summary: "No visuals",
      },
    },
  });
});

test("hydrate restores blocked state without routing through generic error", () => {
  const next = aiCreateSessionReducer(
    createInitialAiCreateSessionState(),
    {
      type: "hydrate",
      threadId: "session-99",
      taskId: "task-99",
      status: "blocked",
      draftMarkdown: "## Partial draft",
      awaitInput: null,
      block: {
        kind: "evidence",
        message: "Could not read source page",
        requiredAction: "Retry the source read",
        allowedResolutions: ["retry", "remove_source"],
      },
    } as any,
  );

  assert.equal(next.status, "blocked");
  assert.equal(next.threadId, "session-99");
  assert.equal(next.taskId, "task-99");
  assert.equal(next.error, null);
  assert.equal(next.awaitInput, null);
  assert.equal(next.accumulatedContent, "## Partial draft");
  assert.deepEqual(next.block, {
    kind: "evidence",
    message: "Could not read source page",
    requiredAction: "Retry the source read",
    allowedResolutions: ["retry", "remove_source"],
  });
});
