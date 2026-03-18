import assert from "node:assert/strict";
import test from "node:test";
import { getAgentSession } from "./agent-service";
import {
  normalizeAgentRunEvent,
  toAwaitInputPhase,
} from "./ai-create-runner.utils";

test("toAwaitInputPhase only accepts supported interrupt phases", () => {
  assert.equal(toAwaitInputPhase("brief"), "brief");
  assert.equal(toAwaitInputPhase("blueprint"), "blueprint");
  assert.equal(toAwaitInputPhase("review"), "review");
  assert.equal(toAwaitInputPhase("clarify"), null);
  assert.equal(toAwaitInputPhase("propose"), null);
  assert.equal(toAwaitInputPhase("outline"), null);
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

test("normalizeAgentRunEvent drops legacy propose interrupt payloads", () => {
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

  assert.equal(event, null);
});

test("normalizeAgentRunEvent drops legacy outline interrupt payloads", () => {
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

  assert.equal(event, null);
});

test("normalizeAgentRunEvent preserves session and completion metadata", () => {
  assert.deepEqual(
    normalizeAgentRunEvent({
      type: "session",
      session_id: "session-42",
      thread_id: "thread-42",
    }),
    {
      type: "session",
      sessionId: "session-42",
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
    kind: "evidence",
    message: "fetch failed",
    required_action: "Retry the fetch before continuing",
    allowed_resolutions: ["retry", "remove_source"],
  });

  assert.deepEqual(event, {
    type: "blocked",
    kind: "evidence",
    message: "fetch failed",
    requiredAction: "Retry the fetch before continuing",
    allowedResolutions: ["retry", "remove_source"],
  });
});

test("normalizeAgentRunEvent preserves draft patch payloads", () => {
  const event = normalizeAgentRunEvent({
    type: "draft_patch",
    markdown: "# Title\n\n## Intro\n\nContent",
    sections: [
      {
        section_id: "intro",
        title: "Intro",
        level: 2,
        content: "Content",
      },
    ],
  });

  assert.deepEqual(event, {
    type: "draft_patch",
    markdown: "# Title\n\n## Intro\n\nContent",
    sections: [
      {
        sectionId: "intro",
        title: "Intro",
        level: 2,
        content: "Content",
      },
    ],
  });
});

test("normalizeAgentRunEvent preserves typed brief payloads", () => {
  const event = normalizeAgentRunEvent({
    type: "await_input",
    phase: "brief",
    data: {
      type: "brief",
      brief: {
        audience: "engineers",
        goal: "explain the system",
        target_length: 1200,
        length_tolerance: 0.1,
        style: "technical",
        tone: "professional",
        structure_strategy: "ai_recommend",
        image_strategy: "mixed",
        constraints: [],
      },
      asset_summary: {
        images: 1,
        tables: 0,
        code: 2,
        text: 3,
        source_word_count: 900,
        source_section_counts: { h1: 1, h2: 3 },
      },
    },
  });

  assert.deepEqual(event, {
    type: "await_input",
    phase: "brief",
    data: {
      type: "brief",
      brief: {
        audience: "engineers",
        goal: "explain the system",
        target_length: 1200,
        length_tolerance: 0.1,
        style: "technical",
        tone: "professional",
        structure_strategy: "ai_recommend",
        image_strategy: "mixed",
        constraints: [],
      },
      asset_summary: {
        images: 1,
        tables: 0,
        code: 2,
        text: 3,
        source_word_count: 900,
        source_section_counts: { h1: 1, h2: 3 },
      },
    },
  });
});

test("getAgentSession normalizes awaiting_input snapshot state", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return {
      ok: true,
      json: async () => ({
        status: "ok",
        session: {
          session_id: "session-42",
          thread_id: "thread-42",
          run_state: "awaiting_input",
          pending_decision: {
            phase: "review",
            data: {
              type: "review",
              report: {
                overall_score: 84,
                length_compliance: 0.97,
                asset_reuse_rate: 0.52,
                issues: [],
                auto_fixed_count: 1,
                user_decision_needed: [],
              },
            },
          },
          blocked: null,
          draft_markdown: "# Draft",
        },
      }),
    } as Response;
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const snapshot = await getAgentSession("session-42");

  assert.equal(requestedUrl, "/api/agent/session/session-42");
  assert.deepEqual(snapshot, {
    sessionId: "session-42",
    threadId: "thread-42",
    status: "awaiting_input",
    awaitInput: {
      phase: "review",
      data: {
        type: "review",
        report: {
          overall_score: 84,
          length_compliance: 0.97,
          asset_reuse_rate: 0.52,
          issues: [],
          auto_fixed_count: 1,
          user_decision_needed: [],
        },
      },
    },
    block: null,
    draftMarkdown: "# Draft",
  });
});

test("getAgentSession preserves blocked snapshots and drops unsupported pending phases", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        status: "ok",
        session: {
          session_id: "session-77",
          thread_id: "thread-77",
          run_state: "blocked",
          pending_decision: {
            phase: "outline",
            data: {
              type: "outline",
              outline: "legacy outline",
            },
          },
          blocked: {
            kind: "evidence",
            message: "Source fetch failed",
            required_action: "Retry the fetch",
            allowed_resolutions: ["retry", "remove_source"],
          },
          draft_markdown: "## Partial",
        },
      }),
    }) as Response) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const snapshot = await getAgentSession("session-77");

  assert.deepEqual(snapshot, {
    sessionId: "session-77",
    threadId: "thread-77",
    status: "blocked",
    awaitInput: null,
    block: {
      kind: "evidence",
      message: "Source fetch failed",
      requiredAction: "Retry the fetch",
      allowedResolutions: ["retry", "remove_source"],
    },
    draftMarkdown: "## Partial",
  });
});
