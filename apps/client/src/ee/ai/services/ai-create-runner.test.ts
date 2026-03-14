import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAgentRunEvent,
  toAwaitInputPhase,
} from "./ai-create-runner.utils";

test("toAwaitInputPhase only accepts supported interrupt phases", () => {
  assert.equal(toAwaitInputPhase("clarify"), "clarify");
  assert.equal(toAwaitInputPhase("propose"), "propose");
  assert.equal(toAwaitInputPhase("outline"), "outline");
  assert.equal(toAwaitInputPhase("unknown"), null);
});

test("normalizeAgentRunEvent maps image payloads to content_delta markdown", () => {
  const event = normalizeAgentRunEvent({
    type: "image",
    alt: "diagram",
    url: "https://example.com/diagram.png",
  });

  assert.deepEqual(event, {
    type: "content_delta",
    chunk: "\n![diagram](https://example.com/diagram.png)\n",
  });
});

test("normalizeAgentRunEvent drops unsupported await_input phases", () => {
  const event = normalizeAgentRunEvent({
    type: "await_input",
    phase: "invalid",
    data: {},
  });

  assert.equal(event, null);
});

test("normalizeAgentRunEvent drops malformed interrupt payloads", () => {
  const event = normalizeAgentRunEvent({
    type: "await_input",
    phase: "propose",
    data: {
      type: "clarify",
      questions: ["wrong payload"],
    },
  });

  assert.equal(event, null);
});

test("normalizeAgentRunEvent preserves typed propose interrupt payloads", () => {
  const event = normalizeAgentRunEvent({
    type: "await_input",
    phase: "propose",
    data: {
      type: "propose",
      proposals: [
        { title: "Option A", description: "Lean structure" },
        { title: "Option B", description: "Evidence first" },
      ],
    },
  });

  assert.deepEqual(event, {
    type: "await_input",
    phase: "propose",
    data: {
      type: "propose",
      proposals: [
        { title: "Option A", description: "Lean structure" },
        { title: "Option B", description: "Evidence first" },
      ],
    },
  });
});

test("normalizeAgentRunEvent normalizes structured outline artifact plans", () => {
  const event = normalizeAgentRunEvent({
    type: "await_input",
    phase: "outline",
    data: {
      type: "outline",
      outline: "## Windows Installation\n## Verification",
      artifact_plan: [
        {
          section_id: "section-1",
          section_title: "Windows Installation",
          artifacts: ["code_block", "table"],
        },
      ],
    },
  });

  assert.deepEqual(event, {
    type: "await_input",
    phase: "outline",
    data: {
      type: "outline",
      outline: "## Windows Installation\n## Verification",
      artifactPlan: [
        {
          sectionId: "section-1",
          sectionTitle: "Windows Installation",
          artifacts: ["code_block", "table"],
        },
      ],
    },
  });
});

test("normalizeAgentRunEvent preserves session and completion metadata", () => {
  assert.deepEqual(
    normalizeAgentRunEvent({
      type: "session",
      thread_id: "thread-42",
    }),
    {
      type: "session",
      threadId: "thread-42",
    },
  );

  assert.deepEqual(
    normalizeAgentRunEvent({
      type: "done",
      final_content: "final draft",
    }),
    {
      type: "done",
      finalContent: "final draft",
    },
  );
});

test("normalizeAgentRunEvent preserves blocked payloads", () => {
  const event = normalizeAgentRunEvent({
    type: "blocked",
    message: "fetch failed",
  });

  assert.deepEqual(event, {
    type: "blocked",
    message: "fetch failed",
  });
});
