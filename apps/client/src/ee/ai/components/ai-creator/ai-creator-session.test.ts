import assert from "node:assert/strict";
import test from "node:test";
import type { AiCreatorMessage } from "./ai-creator.types";
import {
  buildCreatorHistory,
  shouldResetEditorBeforeStreaming,
} from "./ai-creator-session";

test("buildCreatorHistory keeps only prior user and assistant messages", () => {
  const messages: AiCreatorMessage[] = [
    {
      id: "1",
      role: "user",
      content: "Create an overview",
      timestamp: 1,
    },
    {
      id: "2",
      role: "assistant",
      content: "Draft one\n\n---\n*1.2s*",
      timestamp: 2,
    },
    {
      id: "3",
      role: "clarify",
      content: "",
      timestamp: 3,
      questions: ["Who is the audience?"],
    },
    {
      id: "4",
      role: "user",
      content: "Polish this section",
      timestamp: 4,
      selectionContext: "Original selected text",
    },
  ];

  assert.deepEqual(buildCreatorHistory(messages), [
    {
      role: "user",
      content: "Create an overview",
    },
    {
      role: "assistant",
      content: "Draft one",
    },
    {
      role: "user",
      content: "[Selected text]\nOriginal selected text\n\nPolish this section",
    },
  ]);
});

test("shouldResetEditorBeforeStreaming only clears for overwrite without selection", () => {
  assert.equal(shouldResetEditorBeforeStreaming("overwrite", null), true);
  assert.equal(
    shouldResetEditorBeforeStreaming("overwrite", {
      text: "selection",
      from: 1,
      to: 5,
    }),
    false,
  );
  assert.equal(shouldResetEditorBeforeStreaming("append", null), false);
  assert.equal(shouldResetEditorBeforeStreaming("replace", null), false);
});
