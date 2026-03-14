import assert from "node:assert/strict";
import test from "node:test";
import {
  isBubbleAllowedUri,
} from "./ai-creator-bubble-render";

test("allows Docmost uploaded image URLs in AI chat bubbles", () => {
  assert.equal(
    isBubbleAllowedUri("/api/files/file-1/generated-mockup.png"),
    true,
  );
});

test("still rejects unsafe javascript URLs in AI chat bubbles", () => {
  assert.equal(isBubbleAllowedUri("javascript:alert(1)"), false);
});
