import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantPlaceholderMessage,
  createInteractiveMessage,
  createPendingRunMessages,
} from "./ai-create-session.messages";

test("createInteractiveMessage stores typed brief payloads for the brief card", () => {
  const message = createInteractiveMessage("brief", {
    type: "brief",
    brief: {
      audience: "engineers",
      goal: "Explain the system",
      target_length: 1200,
      length_tolerance: 0.1,
      style: "technical",
      tone: "professional",
      structure_strategy: "ai_recommend",
      image_strategy: "none",
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
  });

  assert.equal(message.role, "brief");
  assert.deepEqual(message.briefData, {
    audience: "engineers",
    goal: "Explain the system",
    target_length: 1200,
    length_tolerance: 0.1,
    style: "technical",
    tone: "professional",
    structure_strategy: "ai_recommend",
    image_strategy: "none",
    constraints: [],
  });
  assert.deepEqual(message.briefAssetSummary, {
    images: 1,
    tables: 0,
    code: 2,
    text: 3,
    source_word_count: 900,
    source_section_counts: { h1: 1, h2: 3 },
  });
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
