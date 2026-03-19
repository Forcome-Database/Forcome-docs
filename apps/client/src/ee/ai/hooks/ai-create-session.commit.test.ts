import assert from "node:assert/strict";
import test from "node:test";
import type {
  CreatorCommitParams,
  CreatorCommitResponse,
} from "../services/ai-service";
import {
  captureAiCreatePageSnapshot,
  commitDraftWithRecovery,
  pageSnapshotMatchesCurrentEditor,
} from "./ai-create-session.commit";

function createEditor(body: object) {
  return {
    state: {
      doc: {
        toJSON() {
          return body;
        },
      },
    },
  };
}

function createTitleEditor(title: string) {
  return {
    state: {
      doc: {
        textContent: title,
      },
    },
  };
}

function createCommitResponse(): CreatorCommitResponse {
  return {
    appliedMode: "overwrite",
    fallbackReason: null,
    committedAt: "2026-03-19T04:20:00.000Z",
  };
}

test("pageSnapshotMatchesCurrentEditor detects unchanged editor state", () => {
  const editor = createEditor({ type: "doc", content: [{ type: "paragraph" }] });
  const titleEditor = createTitleEditor("Untitled");
  const snapshot = captureAiCreatePageSnapshot(editor, titleEditor);

  assert.ok(snapshot);
  assert.equal(
    pageSnapshotMatchesCurrentEditor(snapshot, editor, titleEditor),
    true,
  );
});

test("pageSnapshotMatchesCurrentEditor detects body and title changes", () => {
  const snapshot = captureAiCreatePageSnapshot(
    createEditor({ type: "doc", content: [{ type: "paragraph" }] }),
    createTitleEditor("Original"),
  );

  assert.ok(snapshot);
  assert.equal(
    pageSnapshotMatchesCurrentEditor(
      snapshot,
      createEditor({ type: "doc", content: [{ type: "heading" }] }),
      createTitleEditor("Original"),
    ),
    false,
  );
  assert.equal(
    pageSnapshotMatchesCurrentEditor(
      snapshot,
      createEditor({ type: "doc", content: [{ type: "paragraph" }] }),
      createTitleEditor("Changed"),
    ),
    false,
  );
});

test("commitDraftWithRecovery returns the initial commit when no conflict occurs", async () => {
  const calls: CreatorCommitParams[] = [];
  const response = createCommitResponse();

  const result = await commitDraftWithRecovery({
    pageId: "page-1",
    content: "# Draft",
    insertMode: "overwrite",
    expectedUpdatedAt: "2026-03-19T04:00:00.000Z",
    selectionSnapshot: null,
    pageSnapshot: captureAiCreatePageSnapshot(
      createEditor({ type: "doc", content: [] }),
      createTitleEditor(""),
    ),
    editor: createEditor({ type: "doc", content: [] }),
    titleEditor: createTitleEditor(""),
    commit: async (params) => {
      calls.push(params);
      return response;
    },
    fetchLatestPage: async () => ({ updatedAt: "2026-03-19T04:10:00.000Z" }),
  });

  assert.deepEqual(result, {
    ok: true,
    result: response,
    retriedWithLatestVersion: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.expectedUpdatedAt, "2026-03-19T04:00:00.000Z");
});

test("commitDraftWithRecovery retries a 409 when the local page is unchanged", async () => {
  const calls: CreatorCommitParams[] = [];
  const response = createCommitResponse();
  const editor = createEditor({ type: "doc", content: [] });
  const titleEditor = createTitleEditor("");

  const result = await commitDraftWithRecovery({
    pageId: "page-1",
    content: "# Draft",
    insertMode: "overwrite",
    expectedUpdatedAt: "2026-03-19T04:00:00.000Z",
    selectionSnapshot: null,
    pageSnapshot: captureAiCreatePageSnapshot(editor, titleEditor),
    editor,
    titleEditor,
    commit: async (params) => {
      calls.push(params);
      if (calls.length === 1) {
        const error: any = new Error("Conflict");
        error.response = { status: 409 };
        throw error;
      }
      return response;
    },
    fetchLatestPage: async () => ({ updatedAt: "2026-03-19T04:10:00.000Z" }),
  });

  assert.deepEqual(result, {
    ok: true,
    result: response,
    retriedWithLatestVersion: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.expectedUpdatedAt, "2026-03-19T04:10:00.000Z");
});

test("commitDraftWithRecovery does not retry when the local page changed", async () => {
  const calls: CreatorCommitParams[] = [];
  const initialEditor = createEditor({ type: "doc", content: [] });
  const currentEditor = createEditor({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Changed" }] }],
  });
  const titleEditor = createTitleEditor("");
  const conflictError: any = new Error("Conflict");
  conflictError.response = { status: 409 };

  const result = await commitDraftWithRecovery({
    pageId: "page-1",
    content: "# Draft",
    insertMode: "overwrite",
    expectedUpdatedAt: "2026-03-19T04:00:00.000Z",
    selectionSnapshot: null,
    pageSnapshot: captureAiCreatePageSnapshot(initialEditor, titleEditor),
    editor: currentEditor,
    titleEditor,
    commit: async (params) => {
      calls.push(params);
      throw conflictError;
    },
    fetchLatestPage: async () => ({ updatedAt: "2026-03-19T04:10:00.000Z" }),
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "conflict",
    error: conflictError,
  });
  assert.equal(calls.length, 1);
});
