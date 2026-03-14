import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantPlaceholderMessage,
  createInteractiveMessage,
  createPendingRunMessages,
} from "./ai-create-session.messages";

test("createInteractiveMessage preserves structured artifact plans for outline bubbles", () => {
  const message = createInteractiveMessage("outline", {
    type: "outline",
    outline: "## Windows Installation\n## Verification",
    artifactPlan: [
      {
        sectionId: "section-1",
        sectionTitle: "Windows Installation",
        artifacts: ["code_block", "table"],
      },
      {
        sectionId: "section-2",
        sectionTitle: "Verification",
        artifacts: ["callout"],
      },
    ],
  });

  assert.equal(message.role, "outline");
  assert.equal(message.outline, "## Windows Installation\n## Verification");
  assert.deepEqual(message.artifactPlan, [
    {
      sectionId: "section-1",
      sectionTitle: "Windows Installation",
      artifacts: ["code_block", "table"],
    },
    {
      sectionId: "section-2",
      sectionTitle: "Verification",
      artifacts: ["callout"],
    },
  ]);
});

test("createPendingRunMessages creates user and assistant placeholders for submit flow", () => {
  const messages = createPendingRunMessages({
    prompt: "Rewrite this section",
    selection: "Original text",
    selectionRange: { from: 10, to: 20 },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "Rewrite this section");
  assert.equal(messages[0].selectionContext, "Original text");
  assert.deepEqual(messages[0].selectionRange, { from: 10, to: 20 });
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "");
  assert.equal(typeof messages[0].id, "string");
  assert.equal(typeof messages[1].id, "string");
});

test("createAssistantPlaceholderMessage creates an empty assistant message for resume flow", () => {
  const message = createAssistantPlaceholderMessage();

  assert.equal(message.role, "assistant");
  assert.equal(message.content, "");
  assert.equal(typeof message.id, "string");
});
