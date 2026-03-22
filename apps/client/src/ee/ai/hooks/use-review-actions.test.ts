import assert from "node:assert/strict";
import test from "node:test";
import { resolveDefaultSelectedIssueIds } from "./use-review-actions";

test("resolveDefaultSelectedIssueIds falls back to all pending manual issues when user_decision_needed is empty", () => {
  const ids = resolveDefaultSelectedIssueIds({
    overall_score: 68,
    length_compliance: 0.62,
    asset_reuse_rate: 0.9,
    auto_fixed_count: 6,
    user_decision_needed: [],
    issues: [
      {
        id: "issue-info",
        section_id: null,
        severity: "info",
        category: "length",
        description: "Length over budget",
        suggestion: "Trim it",
        auto_fixable: false,
        fixed: false,
      },
      {
        id: "issue-error",
        section_id: null,
        severity: "error",
        category: "structure",
        description: "Duplicated heading",
        suggestion: "Remove duplicate heading",
        auto_fixable: false,
        fixed: false,
      },
      {
        id: "issue-auto-fixed",
        section_id: null,
        severity: "warning",
        category: "asset",
        description: "Already fixed",
        suggestion: "Ignore",
        auto_fixable: true,
        fixed: true,
      },
    ],
  });

  assert.deepEqual(ids, ["issue-info", "issue-error"]);
});

test("resolveDefaultSelectedIssueIds respects explicit user_decision_needed when present", () => {
  const ids = resolveDefaultSelectedIssueIds({
    overall_score: 80,
    length_compliance: 0.8,
    asset_reuse_rate: 0.8,
    auto_fixed_count: 0,
    user_decision_needed: ["issue-error"],
    issues: [
      {
        id: "issue-info",
        section_id: null,
        severity: "info",
        category: "length",
        description: "Length over budget",
        suggestion: "Trim it",
        auto_fixable: false,
        fixed: false,
      },
      {
        id: "issue-error",
        section_id: null,
        severity: "error",
        category: "structure",
        description: "Duplicated heading",
        suggestion: "Remove duplicate heading",
        auto_fixable: false,
        fixed: false,
      },
    ],
  });

  assert.deepEqual(ids, ["issue-error"]);
});
