import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { Button } from "@mantine/core";
import { ExpertCollabPanel } from "./ExpertCollabPanel";

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean,
  results: React.ReactElement[] = [],
): React.ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectElements(child, predicate, results);
    }
    return results;
  }

  if (!React.isValidElement(node)) {
    return results;
  }

  if (predicate(node)) {
    results.push(node);
  }

  collectElements(node.props.children, predicate, results);
  return results;
}

test("ExpertCollabPanel exposes actionable confirm and revise buttons", () => {
  const tree = ExpertCollabPanel({
    reason: "review",
    question: "Accept the reviewed draft?",
    options: [{ id: "confirm" }, { id: "revise" }],
    recommendedOption: "confirm",
  });

  const buttons = collectElements(
    tree,
    (element) => element.type === Button,
  ).map((element) => String(element.props.children));

  assert.deepEqual(buttons, ["CONFIRM", "REVISE"]);
});

test("ExpertCollabPanel routes confirm and revise clicks to dedicated callbacks", () => {
  const events: string[] = [];
  const tree = ExpertCollabPanel({
    reason: "review",
    question: "Accept the reviewed draft?",
    options: [{ id: "confirm" }, { id: "revise" }],
    recommendedOption: "confirm",
    onConfirm: () => events.push("confirm"),
    onRevise: () => events.push("revise"),
  } as any);

  const buttons = collectElements(tree, (element) => element.type === Button);

  buttons[0]?.props.onClick?.();
  buttons[1]?.props.onClick?.();

  assert.deepEqual(events, ["confirm", "revise"]);
});
