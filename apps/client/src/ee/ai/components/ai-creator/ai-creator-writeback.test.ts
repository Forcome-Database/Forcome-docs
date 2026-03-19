import assert from "node:assert/strict";
import test from "node:test";
import {
  insertMarkdownAtDocumentEnd,
  splitMarkdownForEditorInsert,
} from "./ai-creator-writeback";

function createInsertEditor(runResults: boolean[] = []) {
  const inserted: string[] = [];
  let runIndex = 0;

  const chainApi = {
    focus() {
      return chainApi;
    },
    insertContent(html: string) {
      inserted.push(html);
      return chainApi;
    },
    run() {
      const result = runResults[runIndex];
      runIndex += 1;
      return result ?? true;
    },
  };

  return {
    inserted,
    editor: {
      chain() {
        return chainApi;
      },
    },
  };
}

test("splitMarkdownForEditorInsert groups paragraphs under the chunk budget", () => {
  const markdown = [
    "A".repeat(12),
    "B".repeat(12),
    "C".repeat(12),
    "D".repeat(12),
  ].join("\n\n");

  assert.deepEqual(splitMarkdownForEditorInsert(markdown, 30), [
    `${"A".repeat(12)}\n\n${"B".repeat(12)}`,
    `${"C".repeat(12)}\n\n${"D".repeat(12)}`,
  ]);
});

test("insertMarkdownAtDocumentEnd writes long markdown in multiple editor transactions", () => {
  const { editor, inserted } = createInsertEditor();
  const markdown = [
    "first paragraph".repeat(8),
    "second paragraph".repeat(8),
    "third paragraph".repeat(8),
  ].join("\n\n");

  const insertedOk = insertMarkdownAtDocumentEnd(editor, markdown, 120);

  assert.equal(insertedOk, true);
  assert.equal(inserted.length, 3);
});

test("insertMarkdownAtDocumentEnd stops when a chunk insert fails", () => {
  const { editor, inserted } = createInsertEditor([true, false]);
  const markdown = [
    "first paragraph".repeat(8),
    "second paragraph".repeat(8),
    "third paragraph".repeat(8),
  ].join("\n\n");

  const insertedOk = insertMarkdownAtDocumentEnd(editor, markdown, 120);

  assert.equal(insertedOk, false);
  assert.equal(inserted.length, 2);
});
