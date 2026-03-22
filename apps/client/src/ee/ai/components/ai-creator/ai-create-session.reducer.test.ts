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
    draftSections: [],
    brief: null,
    blueprint: null,
    reviewReport: null,
    evidenceSummary: null,
    documentTask: {
      status: "idle",
      sourceScope: "current_page",
      mode: "strict_preservation",
      deepCollaborationEnabled: true,
      taskSummary: {
        summarySource: "structured_summary",
        includeRawHistory: false,
        summary: "",
      },
      plan: null,
      diffSet: [],
      pendingChangeSet: [],
      rollbackSnapshot: null,
      draftSections: [],
      brief: null,
      blueprint: null,
      reviewReport: null,
      evidenceSummary: null,
    },
    inlineRewrite: {
      status: "idle",
      selectionSnapshot: null,
      candidateResult: null,
      actionType: null,
      taskSummaryRef: null,
    },
    expertCollab: {
      status: "idle",
      reason: null,
      question: null,
      options: [],
      recommendedOption: null,
      confirmedDecision: null,
      genericMessage: null,
    },
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

test("hydrate preserves workbench metadata and document tree sections", () => {
  const next = aiCreateSessionReducer(
    createInitialAiCreateSessionState(),
    {
      type: "hydrate",
      threadId: "session-314",
      taskId: null,
      status: "running",
      draftMarkdown: "# Draft\n\n## Intro\n\nBody",
      draftSections: [
        {
          nodeId: "section:intro",
          sectionId: "intro",
          title: "Intro",
          level: 2,
          content: "Body",
        },
      ],
      brief: {
        audience: "operators",
        goal: "Explain deployment",
        target_length: 900,
        length_tolerance: 0.1,
        style: "technical",
        tone: "direct",
        structure_strategy: "ai_recommend",
        image_strategy: "none",
        constraints: [],
      },
      blueprint: {
        title: "Deployment Guide",
        sections: [],
        total_word_budget: 900,
        style_guide: "Direct",
        visual_plan_summary: "No visuals",
      },
      reviewReport: {
        overall_score: 81,
        length_compliance: 0.9,
        asset_reuse_rate: 0.4,
        issues: [],
        auto_fixed_count: 0,
        user_decision_needed: [],
      },
      evidenceSummary: {
        total: 2,
        requiredTotal: 1,
        optionalTotal: 1,
        failedRequired: 0,
      },
      awaitInput: null,
      block: null,
    } as any,
  );

  assert.deepEqual(next.draftSections, [
    {
      nodeId: "section:intro",
      sectionId: "intro",
      title: "Intro",
      level: 2,
      content: "Body",
    },
  ]);
  assert.equal(next.brief?.goal, "Explain deployment");
  assert.equal(next.blueprint?.title, "Deployment Guide");
  assert.equal(next.reviewReport?.overall_score, 81);
  assert.deepEqual(next.evidenceSummary, {
    total: 2,
    requiredTotal: 1,
    optionalTotal: 1,
    failedRequired: 0,
  });
});

test("draft_patch replaces draft markdown and document tree sections together", () => {
  const next = aiCreateSessionReducer(
    createInitialAiCreateSessionState(),
    {
      type: "draft_patch",
      markdown: "# Draft\n\n## Intro\n\nUpdated body",
      sections: [
        {
          nodeId: "section:intro",
          sectionId: "intro",
          title: "Intro",
          level: 2,
          content: "Updated body",
        },
      ],
    } as any,
  );

  assert.equal(next.accumulatedContent, "# Draft\n\n## Intro\n\nUpdated body");
  assert.deepEqual(next.draftSections, [
    {
      nodeId: "section:intro",
      sectionId: "intro",
      title: "Intro",
      level: 2,
      content: "Updated body",
    },
  ]);
});

test("await_input updates document-task structured summary without inheriting raw message history", () => {
  const next = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "await_input",
    phase: "brief",
    data: {
      type: "brief" as const,
      brief: {
        audience: "engineers",
        goal: "Keep source structure and images intact",
        target_length: 1200,
        length_tolerance: 0.1,
        style: "technical",
        tone: "direct",
        structure_strategy: "ai_recommend",
        image_strategy: "none",
        constraints: [],
      },
      asset_summary: {
        images: 1,
        tables: 0,
        code: 1,
        text: 4,
        source_word_count: 900,
        source_section_counts: { h1: 1, h2: 2 },
      },
    },
  });

  assert.equal(next.documentTask.taskSummary.summarySource, "structured_summary");
  assert.equal(next.documentTask.taskSummary.includeRawHistory, false);
  assert.equal(
    next.documentTask.taskSummary.summary,
    "Keep source structure and images intact",
  );
});

test("document_task_configured stores real source scope and workflow-only preference", () => {
  const next = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "document_task_configured",
    sourceScope: "uploaded_document",
    mode: "strict_preservation",
    deepCollaborationEnabled: false,
  });

  assert.equal(next.documentTask.sourceScope, "uploaded_document");
  assert.equal(next.documentTask.mode, "strict_preservation");
  assert.equal(next.documentTask.deepCollaborationEnabled, false);
});

test("inline rewrite state stays independent from document-task state", () => {
  const started = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "inline_rewrite_updated",
    selectionSnapshot: {
      text: "Original sentence",
      from: 10,
      to: 27,
    },
    candidateResult: "Rewritten sentence",
    actionType: "improve_writing",
    taskSummaryRef: {
      summary: "Use local context only",
      includeRawHistory: false,
    },
  } as any);

  const next = aiCreateSessionReducer(started, {
    type: "await_input",
    phase: "blueprint",
    data: {
      type: "blueprint" as const,
      blueprint: {
        title: "Document Plan",
        sections: [],
        total_word_budget: 1500,
        style_guide: "Direct",
        visual_plan_summary: "No visuals",
      },
    },
  });

  assert.equal(next.inlineRewrite.selectionSnapshot?.text, "Original sentence");
  assert.equal(next.inlineRewrite.candidateResult, "Rewritten sentence");
  assert.equal(next.documentTask.blueprint?.title, "Document Plan");
});

test("expert collaboration state stores structured decisions instead of generic messages", () => {
  const pending = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "await_input",
    phase: "review",
    data: {
      type: "review" as const,
      report: {
        overall_score: 87,
        length_compliance: 0.98,
        asset_reuse_rate: 0.8,
        issues: [],
        auto_fixed_count: 0,
        user_decision_needed: [],
      },
    },
  });

  const next = aiCreateSessionReducer(pending, {
    type: "expert_collab_confirmed",
    reason: "review",
    decision: {
      resolution: "accept_review",
      source: "structured_card",
    },
  } as any);

  assert.equal(next.expertCollab.reason, "review");
  assert.deepEqual(next.expertCollab.confirmedDecision, {
    resolution: "accept_review",
    source: "structured_card",
  });
  assert.equal(next.expertCollab.genericMessage, null);
});

test("pending_changes_prepared stores reviewed draft changes for later apply", () => {
  const next = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "pending_changes_prepared",
    pendingChangeSet: [
      {
        changeId: "change-1",
        label: "Apply reviewed article",
        content: "# Reviewed draft",
        insertMode: "overwrite",
        selectionSnapshot: null,
      },
    ],
  } as any);

  assert.deepEqual(next.documentTask.pendingChangeSet, [
    {
      changeId: "change-1",
      label: "Apply reviewed article",
      content: "# Reviewed draft",
      insertMode: "overwrite",
      selectionSnapshot: null,
    },
  ]);
});

test("apply_completed clears pending changes and registers rollback snapshot", () => {
  const prepared = aiCreateSessionReducer(createInitialAiCreateSessionState(), {
    type: "pending_changes_prepared",
    pendingChangeSet: [
      {
        changeId: "change-1",
        label: "Apply reviewed article",
        content: "# Reviewed draft",
        insertMode: "overwrite",
        selectionSnapshot: null,
      },
    ],
  } as any);

  const applied = aiCreateSessionReducer(prepared, {
    type: "apply_completed",
    rollbackSnapshot: {
      title: "Original title",
      bodyJson: '{"type":"doc","content":[]}',
    },
  } as any);

  assert.deepEqual(applied.documentTask.pendingChangeSet, []);
  assert.deepEqual(applied.documentTask.rollbackSnapshot, {
    title: "Original title",
    bodyJson: '{"type":"doc","content":[]}',
  });
});
