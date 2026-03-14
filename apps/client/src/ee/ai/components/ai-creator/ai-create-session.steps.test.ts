import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentStepEvent } from "./ai-create-session.steps";

test("suppresses replayed interrupt step start during resume", () => {
  const existingSteps = [
    {
      step: "clarify",
      description: "正在分析是否需要进一步了解需求...",
      status: "done" as const,
      resultSummary: "提出了 3 个澄清问题",
    },
  ];

  const result = applyAgentStepEvent(
    existingSteps,
    {
      type: "step_start",
      step: "clarify",
      description: "正在分析是否需要进一步了解需求...",
    },
    "clarify",
  );

  assert.deepEqual(result.steps, existingSteps);
  assert.equal(result.replayedStep, "clarify");
});

test("suppresses replayed interrupt step completion during resume", () => {
  const existingSteps = [
    {
      step: "clarify",
      description: "正在分析是否需要进一步了解需求...",
      status: "done" as const,
      resultSummary: "提出了 3 个澄清问题",
    },
  ];

  const result = applyAgentStepEvent(
    existingSteps,
    {
      type: "step_done",
      step: "clarify",
      resultSummary: "提出了 3 个澄清问题",
    },
    "clarify",
  );

  assert.deepEqual(result.steps, existingSteps);
  assert.equal(result.replayedStep, "clarify");
});

test("clears replay suppression when the next real step begins", () => {
  const existingSteps = [
    {
      step: "clarify",
      description: "正在分析是否需要进一步了解需求...",
      status: "done" as const,
      resultSummary: "提出了 3 个澄清问题",
    },
  ];

  const result = applyAgentStepEvent(
    existingSteps,
    {
      type: "step_start",
      step: "propose",
      description: "正在构思写作方案...",
    },
    "clarify",
  );

  assert.deepEqual(result.steps, [
    ...existingSteps,
    {
      step: "propose",
      description: "正在构思写作方案...",
      status: "running",
      resultSummary: undefined,
    },
  ]);
  assert.equal(result.replayedStep, null);
});
