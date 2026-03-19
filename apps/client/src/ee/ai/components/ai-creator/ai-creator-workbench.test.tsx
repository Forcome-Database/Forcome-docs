import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveBlockedWorkbenchAction,
  shouldRenderWorkbenchModal,
} from "./ai-creator-workbench";
import { BlockedResolutionCard } from "./blocked/BlockedResolutionCard";
import { BlueprintModal } from "./blueprint/BlueprintModal";
import { DocumentTreePanel } from "./document-tree/DocumentTreePanel";
import { ReviewModal } from "./review/ReviewModal";

function renderWithinMantine(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <MantineProvider>{element}</MantineProvider>,
  );
}

test("resolveBlockedWorkbenchAction opens the review modal for review block resolutions", () => {
  assert.deepEqual(
    resolveBlockedWorkbenchAction({
      resolution: "fix_selected_issues",
      hasBlueprint: false,
      hasReview: true,
    }),
    { kind: "open_review" },
  );
});

test("resolveBlockedWorkbenchAction sends explicit block resumes for evidence recovery", () => {
  assert.deepEqual(
    resolveBlockedWorkbenchAction({
      resolution: "retry",
      hasBlueprint: false,
      hasReview: false,
    }),
    {
      kind: "resume_block",
      resumeValue: {
        type: "resolve_block",
        resolution: "retry",
      },
    },
  );
});

test("shouldRenderWorkbenchModal keeps blocked review data reopenable", () => {
  assert.equal(
    shouldRenderWorkbenchModal({
      opened: true,
      hasData: true,
      awaitPhase: null,
      expectedPhase: "review",
      isBlocked: true,
    }),
    true,
  );
});

test("BlockedResolutionCard renders recoverable actions instead of a fatal error shell", () => {
  const html = renderWithinMantine(
    <BlockedResolutionCard
      block={{
        kind: "evidence",
        message: "Required evidence could not be collected",
        requiredAction: "Retry the failed evidence step or remove the missing source",
        allowedResolutions: ["retry", "remove_source"],
      }}
    />,
  );

  assert.match(html, /Blocked/);
  assert.match(html, /Required evidence could not be collected/);
  assert.match(html, /Retry/);
  assert.match(html, /Remove source/);
});

test("DocumentTreePanel renders section titles and per-section draft state", () => {
  const html = renderWithinMantine(
    <DocumentTreePanel
      status="running"
      sections={[
        {
          nodeId: "section:intro",
          sectionId: "intro",
          title: "Introduction",
          level: 2,
          content: "Existing draft copy",
          writeAttempts: 2,
          imageStatus: "generated",
        },
        {
          nodeId: "section:appendix",
          sectionId: "appendix",
          title: "Appendix",
          level: 2,
          content: "",
        },
      ]}
    />,
  );

  assert.match(html, /Document Tree/);
  assert.match(html, /Introduction/);
  assert.match(html, /Drafted/);
  assert.match(html, /2 attempts/);
  assert.match(html, /generated/);
  assert.match(html, /Appendix/);
  assert.match(html, /Writing/);
});

test("BlueprintModal surfaces source image candidates for review", () => {
  const html = renderWithinMantine(
    <BlueprintModal
      opened
      onClose={() => {}}
      onConfirm={() => {}}
      withinPortal={false}
      blueprint={{
        title: "Login PRD",
        total_word_budget: 1200,
        style_guide: "Be concrete",
        visual_plan_summary: "Prefer source image reuse",
        sections: [
          {
            id: "s1",
            title: "Overview",
            level: 2,
            word_budget: 300,
            description: "Explain the login architecture",
            assets: [],
            visuals: [],
            visual_candidates: [
              {
                asset_id: "img-001",
                score: 2.5,
                caption: "Login architecture diagram",
                source: "source.pdf",
                source_page: 1,
                source_heading: "Architecture",
                rationale: "overlap: login, architecture",
              },
            ],
            must_cover: [],
          },
        ],
      }}
    />,
  );

  assert.match(html, /Login architecture diagram/);
  assert.match(html, /source\.pdf/);
});

test("ReviewModal exposes a continue action for non-blocking review issues", () => {
  const html = renderWithinMantine(
    <ReviewModal
      opened
      withinPortal={false}
      onClose={() => {}}
      onFixSelected={() => {}}
      onContinue={() => {}}
      onSkip={() => {}}
      report={{
        overall_score: 78,
        length_compliance: 0.92,
        asset_reuse_rate: 1,
        auto_fixed_count: 0,
        user_decision_needed: ["issue-1", "issue-2"],
        issues: [
          {
            id: "issue-1",
            section_id: "s1",
            severity: "warning",
            category: "content",
            description: "Could be more concise.",
            suggestion: "Tighten the wording.",
            auto_fixable: false,
            fixed: false,
          },
          {
            id: "issue-2",
            section_id: "s1",
            severity: "info",
            category: "length",
            description: "Slightly above the target budget.",
            suggestion: "Trim a few words if needed.",
            auto_fixable: false,
            fixed: false,
          },
        ],
      }}
    />,
  );

  assert.match(html, /Continue with current draft/);
});
