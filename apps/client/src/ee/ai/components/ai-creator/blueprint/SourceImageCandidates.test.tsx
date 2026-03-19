import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { applySectionSourceImageSelection } from "./BlueprintModal";
import { SourceImageCandidates } from "./SourceImageCandidates";

function renderWithinMantine(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <MantineProvider>{element}</MantineProvider>,
  );
}

test("SourceImageCandidates renders caption and provenance metadata", () => {
  const html = renderWithinMantine(
    <SourceImageCandidates
      candidates={[
        {
          asset_id: "img-001",
          score: 3.5,
          caption: "Architecture overview diagram",
          source: "spec.pdf",
          source_page: 2,
          source_heading: "Architecture",
          rationale: "overlap: architecture, overview",
        },
      ]}
      selectedCandidateId="img-001"
      onSelect={() => {}}
      onPreferGenerated={() => {}}
    />,
  );

  assert.match(html, /Architecture overview diagram/);
  assert.match(html, /spec\.pdf/);
  assert.match(html, /p\.2/);
  assert.match(html, /Selected/);
});

test("applySectionSourceImageSelection switches a section to reuse_image", () => {
  const section = {
    id: "s1",
    title: "Overview",
    level: 2,
    word_budget: 300,
    description: "Overview",
    assets: [],
    visuals: [
      {
        type: "ai_image" as const,
        description: "Generate image",
        source_asset_id: null,
        position: "before_section" as const,
      },
    ],
    visual_candidates: [],
    must_cover: [],
  };

  const updated = applySectionSourceImageSelection(section, "img-001");

  assert.equal(updated.visuals[0]?.type, "reuse_image");
  assert.equal(updated.visuals[0]?.source_asset_id, "img-001");
});
