import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentOperationCenter } from "./DocumentOperationCenter";

function renderWithinMantine(element: React.ReactElement): string {
  return renderToStaticMarkup(<MantineProvider>{element}</MantineProvider>);
}

test("DocumentOperationCenter defaults to task header, controls, diff workspace, and pending change bar", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="uploaded_document"
      mode="strict_preservation"
      taskSummary="Keep the uploaded document structure and images intact."
      steps={[
        {
          step: "parse_assets",
          description: "Parse uploaded source files",
          status: "done",
          resultSummary: "1 source parsed",
        },
        {
          step: "preservation_patch",
          description: "Generate the preservation patch",
          status: "running",
        },
      ]}
      diffSet={[{ diffId: "diff-1", label: "Intro block rewrite", granularity: "block" }]}
      pendingChangeCount={2}
      canApply
      canRollback={false}
    />,
  );

  assert.match(html, /Document Task/);
  assert.match(html, /Source Scope/);
  assert.match(html, /Uploaded document/);
  assert.match(html, /Mode/);
  assert.match(html, /Strict preservation/);
  assert.match(html, /Latest update/);
  assert.match(html, /Generate the preservation patch/);
  assert.match(html, /Show all updates/);
  assert.match(html, /Structured Task Summary/);
  assert.match(html, /Keep the uploaded document structure and images intact\./);
  assert.match(html, /Diff Review/);
  assert.match(html, /Pending Changes/);
  assert.match(html, /Apply accepted changes/);
  assert.match(html, /Rollback snapshot/);
});

test("DocumentOperationCenter can render the expanded activity timeline when requested", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="running"
      sourceScope="uploaded_document"
      mode="strict_preservation"
      taskSummary="Preserve source structure."
      steps={[
        {
          step: "parse_assets",
          description: "Parse uploaded source files",
          status: "done",
          resultSummary: "1 source parsed",
        },
        {
          step: "preservation_patch",
          description: "Generate the preservation patch",
          status: "running",
        },
      ]}
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={false}
      defaultExpanded
    />,
  );

  assert.match(html, /Agent progress/);
  assert.match(html, /Parse uploaded source files/);
  assert.match(html, /1 source parsed/);
  assert.match(html, /Generate the preservation patch/);
  assert.match(html, /Show latest only/);
});

test("DocumentOperationCenter renders plan confirmation without pretending it is a chat transcript", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="current_page"
      mode="strict_preservation"
      taskSummary="Confirm the current-page preservation plan."
      plan={{
        title: "Preservation plan",
        sections: ["Overview", "Workflow"],
      }}
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={true}
    />,
  );

  assert.match(html, /Plan Preview/);
  assert.match(html, /Preservation plan/);
  assert.match(html, /Overview/);
  assert.match(html, /Workflow/);
  assert.doesNotMatch(html, /Document Tree/);
  assert.doesNotMatch(html, /Live Draft/);
  assert.doesNotMatch(html, /Activity Log/);
});

test("DocumentOperationCenter surfaces brief approval controls in the new shell", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="blank_page"
      mode="strict_preservation"
      taskSummary="Draft a concise technical note."
      brief={{
        audience: "Engineering",
        goal: "Draft a concise technical note.",
        target_length: 300,
        length_tolerance: 0.1,
        style: "Professional",
        tone: "Direct",
        structure_strategy: "ai_recommend",
        image_strategy: "none",
        constraints: [],
      }}
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={false}
      onConfirmBrief={() => {}}
    />,
  );

  assert.match(html, /Smart Brief/);
  assert.match(html, /Confirm and continue/);
});

test("DocumentOperationCenter exposes blueprint and review checkpoints in the new shell", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="blank_page"
      mode="strict_preservation"
      taskSummary="Draft a concise technical note."
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={false}
      onOpenBlueprint={() => {}}
      onOpenReview={() => {}}
    />,
  );

  assert.match(html, /Review blueprint/);
  assert.match(html, /Open review/);
});

test("DocumentOperationCenter provides its own scroll region so long task cards remain reachable", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="current_page"
      mode="strict_preservation"
      taskSummary="A very long task summary that should stay reachable even when the panel body itself is overflow hidden."
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={false}
    />,
  );

  assert.match(html, /data-document-task-scroll-region="true"/);
  assert.match(html, /overflow-y:auto/);
});

test("DocumentOperationCenter renders expert collaboration confirm and revise controls", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="uploaded_document"
      mode="strict_preservation"
      taskSummary="Review the uploaded document rewrite."
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={false}
      onOpenReview={() => {}}
      onConfirmExpertCollab={() => {}}
      onReviseExpertCollab={() => {}}
      expertCollab={{
        reason: "review",
        question: "Accept the reviewed draft?",
        options: [{ id: "confirm" }, { id: "revise" }],
        recommendedOption: "confirm",
      }}
    />,
  );

  assert.match(html, /Expert Collaboration/);
  assert.match(html, /Accept the reviewed draft\?/);
  assert.match(html, /Confirm/);
  assert.match(html, /Revise/);
});

test("DocumentOperationCenter exposes workflow-only control when deep collaboration is disabled", () => {
  const html = renderWithinMantine(
    <DocumentOperationCenter
      status="awaiting_input"
      sourceScope="uploaded_document"
      mode="strict_preservation"
      taskSummary="Preserve the uploaded document without extra collaboration."
      diffSet={[]}
      pendingChangeCount={0}
      canApply={false}
      canRollback={false}
      deepCollaborationEnabled={false}
      onToggleDeepCollaboration={() => {}}
      expertCollab={{
        reason: "review",
        question: "Accept the reviewed draft?",
        options: [{ id: "confirm" }, { id: "revise" }],
        recommendedOption: "confirm",
      }}
    />,
  );

  assert.match(html, /Workflow only/);
  assert.doesNotMatch(html, /Expert Collaboration/);
});
