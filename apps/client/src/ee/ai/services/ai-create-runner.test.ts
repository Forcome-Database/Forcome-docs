import assert from "node:assert/strict";
import test from "node:test";
import { agentGenerate, getAgentSession, resumeAgent } from "./agent-service";
import {
  normalizeAgentRunEvent,
  toAwaitInputPhase,
} from "./ai-create-runner.utils";

function createStreamingResponse(
  chunks: string[],
  headers: Record<string, string> = {},
): Response {
  let index = 0;
  const encoder = new TextEncoder();

  return {
    ok: true,
    headers: {
      get(name: string) {
        return headers[name] ?? headers[name.toLowerCase()] ?? null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) {
              return { done: true, value: undefined };
            }

            return {
              done: false,
              value: encoder.encode(chunks[index++]),
            };
          },
        };
      },
    },
  } as unknown as Response;
}

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
        node_id: "section:intro",
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
        nodeId: "section:intro",
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

test("agentGenerate flushes the final buffered SSE event before completion", async (t) => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let completed = false;
  let receivedTaskId: string | null = null;

  globalThis.fetch = (async () =>
    createStreamingResponse(
      [
        'data: {"type":"session","session_id":"session-1","thread_id":"thread-1"}\n',
        'data: {"type":"await_input","phase":"review","data":{"type":"review","report":{"overall_score":84,"length_compliance":0.97,"asset_reuse_rate":0.5,"issues":[],"auto_fixed_count":0,"user_decision_needed":[]}}}',
      ],
      { 'X-Task-Id': 'task-99' },
    )) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  agentGenerate(
    {
      prompt: "test prompt",
      pageId: "page-1",
    },
    (event) => {
      events.push(event.type);
    },
    (message) => {
      throw new Error(message);
    },
    () => {
      completed = true;
    },
    (taskId) => {
      receivedTaskId = taskId;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(receivedTaskId, "task-99");
  assert.equal(completed, true);
  assert.deepEqual(events, ["session", "await_input"]);
});

test("resumeAgent flushes the final buffered SSE event before completion", async (t) => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let completed = false;

  globalThis.fetch = (async () =>
    createStreamingResponse([
      'data: {"type":"session","session_id":"session-2","thread_id":"thread-2"}\n',
      'data: {"type":"await_input","phase":"review","data":{"type":"review","report":{"overall_score":90,"length_compliance":1,"asset_reuse_rate":1,"issues":[],"auto_fixed_count":0,"user_decision_needed":[]}}}',
    ])) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  resumeAgent(
    "session-2",
    { type: "confirm_brief", brief: { audience: "engineers" } },
    (event) => {
      events.push(event.type);
    },
    (message) => {
      throw new Error(message);
    },
    () => {
      completed = true;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(completed, true);
  assert.deepEqual(events, ["session", "await_input"]);
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
          draft_sections: [
            {
              node_id: "section:intro",
              section_id: "intro",
              title: "Intro",
              level: 2,
              content: "Content",
            },
          ],
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
    brief: null,
    blueprint: null,
    reviewReport: null,
    evidenceSummary: null,
    draftMarkdown: "# Draft",
    draftSections: [
      {
        nodeId: "section:intro",
        sectionId: "intro",
        title: "Intro",
        level: 2,
        content: "Content",
      },
    ],
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
          draft_sections: [],
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
    brief: null,
    blueprint: null,
    reviewReport: null,
    evidenceSummary: null,
    draftMarkdown: "## Partial",
    draftSections: [],
  });
});

test("getAgentSession preserves workbench metadata for side panels", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        status: "ok",
        session: {
          session_id: "session-88",
          thread_id: "thread-88",
          run_state: "running",
          pending_decision: null,
          blocked: null,
          brief: {
            audience: "engineers",
            goal: "Explain the architecture",
            target_length: 1600,
            length_tolerance: 0.1,
            style: "technical",
            tone: "direct",
            structure_strategy: "ai_recommend",
            image_strategy: "mixed",
            constraints: [],
          },
          blueprint: {
            title: "Architecture Guide",
            sections: [
              {
                id: "intro",
                title: "Intro",
                level: 2,
                word_budget: 400,
                description: "Explain the system",
                assets: [],
                visuals: [],
                must_cover: ["context"],
              },
            ],
            total_word_budget: 1600,
            style_guide: "Direct and specific",
            visual_plan_summary: "One diagram",
          },
          review_report: {
            overall_score: 83,
            length_compliance: 0.94,
            asset_reuse_rate: 0.5,
            issues: [],
            auto_fixed_count: 1,
            user_decision_needed: [],
          },
          evidence_summary: {
            total: 3,
            required_total: 2,
            optional_total: 1,
            failed_required: 0,
          },
          draft_markdown: "# Draft",
          draft_sections: [
            {
              node_id: "section:intro",
              section_id: "intro",
              title: "Intro",
              level: 2,
              content: "Intro content",
              write_attempts: 2,
              image_status: "generated",
              source_image_asset_id: "img-source-1",
              degraded_reason: "source asset unavailable",
            },
          ],
        },
      }),
    }) as Response) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const snapshot = await getAgentSession("session-88");

  assert.deepEqual(snapshot, {
    sessionId: "session-88",
    threadId: "thread-88",
    status: "running",
    awaitInput: null,
    block: null,
    brief: {
      audience: "engineers",
      goal: "Explain the architecture",
      target_length: 1600,
      length_tolerance: 0.1,
      style: "technical",
      tone: "direct",
      structure_strategy: "ai_recommend",
      image_strategy: "mixed",
      constraints: [],
    },
    blueprint: {
      title: "Architecture Guide",
      sections: [
        {
          id: "intro",
          title: "Intro",
          level: 2,
          word_budget: 400,
          description: "Explain the system",
          assets: [],
          visuals: [],
          must_cover: ["context"],
        },
      ],
      total_word_budget: 1600,
      style_guide: "Direct and specific",
      visual_plan_summary: "One diagram",
    },
    reviewReport: {
      overall_score: 83,
      length_compliance: 0.94,
      asset_reuse_rate: 0.5,
      issues: [],
      auto_fixed_count: 1,
      user_decision_needed: [],
    },
    evidenceSummary: {
      total: 3,
      requiredTotal: 2,
      optionalTotal: 1,
      failedRequired: 0,
    },
    draftMarkdown: "# Draft",
    draftSections: [
      {
        nodeId: "section:intro",
        sectionId: "intro",
        title: "Intro",
        level: 2,
        content: "Intro content",
        writeAttempts: 2,
        imageStatus: "generated",
        sourceImageAssetId: "img-source-1",
        degradedReason: "source asset unavailable",
      },
    ],
  });
});
