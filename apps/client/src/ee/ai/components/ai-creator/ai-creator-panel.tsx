import { useEffect, useCallback, useState } from "react";
import {
  ActionIcon,
  Group,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconX, IconPlus } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { NodeSelection } from "@tiptap/pm/state";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  SelectionRange,
} from "./ai-creator-atoms";
import { AiCreatorSelection } from "./ai-creator-selection";
import { AiCreatorInput } from "./ai-creator-input";
import { useAiCreateSession } from "@/ee/ai/hooks/use-ai-create-session";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { usePageQuery } from "@/features/page/queries/page-query";
import { BlueprintModal } from "./blueprint/BlueprintModal";
import { DocumentOperationCenter } from "./document-task/DocumentOperationCenter";
import { ReviewModal } from "./review/ReviewModal";
import {
  resolveBlockedWorkbenchAction,
  shouldRenderWorkbenchModal,
} from "./ai-creator-workbench";
import type { ReviewReport } from "@/ee/ai/types/review.types";
import classes from "./ai-creator.module.css";

function hasBlockingReviewIssues(report: ReviewReport | null): boolean {
  if (!report) {
    return false;
  }

  return report.issues.some(
    (issue) => issue.severity === "error" && !issue.fixed && !issue.auto_fixable,
  );
}

function formatDocumentTaskMode(
  mode: "strict_preservation" | "relaxed_optimization",
): string {
  return mode;
}

export default function AiCreatorPanel() {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const [, setSelection] = useAtom(aiCreatorSelectionAtom);
  const [, _setSelectionRange] = useAtom(aiCreatorSelectionRangeAtom);
  const setSelectionRange = _setSelectionRange as (v: SelectionRange | null) => void;
  const setAsideState = useAtom(asideStateAtom)[1];
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const { data: page } = usePageQuery({ pageId });
  const hasSelection = useAtomValue(aiCreatorSelectionAtom).length > 0;
  const [blueprintOpened, setBlueprintOpened] = useState(false);
  const [reviewOpened, setReviewOpened] = useState(false);

  const lockEditor = useCallback(() => {
    if (!editor) return;
    editor.setEditable(false);
    editor.view.dom.classList.add("ai-generating");
  }, [editor]);

  const unlockEditor = useCallback(() => {
    if (!editor) return;
    editor.setEditable(true);
    editor.view.dom.classList.remove("ai-generating");
  }, [editor]);

  const session = useAiCreateSession({
    pageId,
    pageUpdatedAt: page?.updatedAt ?? null,
    editor,
    titleEditor,
    lockEditor,
    unlockEditor,
  });
  const currentBrief =
    session.awaitInput?.phase === "brief" && session.awaitInput.data.type === "brief"
      ? session.awaitInput.data.brief
      : session.brief;
  const currentAssetSummary =
    session.awaitInput?.phase === "brief" && session.awaitInput.data.type === "brief"
      ? session.awaitInput.data.asset_summary
      : undefined;
  const currentBlueprint =
    session.awaitInput?.phase === "blueprint" && session.awaitInput.data.type === "blueprint"
      ? session.awaitInput.data.blueprint
      : session.blueprint;
  const currentReviewReport =
    session.awaitInput?.phase === "review" && session.awaitInput.data.type === "review"
      ? session.awaitInput.data.report
      : session.reviewReport;
  const handleExpertCollabConfirm = useCallback(() => {
    const phase = session.awaitInput?.phase;
    if (!phase) {
      return;
    }

    if (phase === "review") {
      if (hasBlockingReviewIssues(currentReviewReport)) {
        setReviewOpened(true);
        return;
      }

      session.resume({ type: "accept_review" });
      return;
    }

    if (phase === "blueprint" && currentBlueprint) {
      session.resume({
        type: "confirm_blueprint",
        blueprint: currentBlueprint as unknown as Record<string, unknown>,
      });
      return;
    }

    if (phase === "brief" && currentBrief) {
      session.resume({
        type: "confirm_brief",
        brief: currentBrief as unknown as Record<string, unknown>,
      });
    }
  }, [currentBlueprint, currentBrief, currentReviewReport, session]);

  const handleExpertCollabRevise = useCallback(() => {
    const phase = session.awaitInput?.phase;
    if (phase === "review" && currentReviewReport) {
      setReviewOpened(true);
      return;
    }

    if (phase === "blueprint" && currentBlueprint) {
      setBlueprintOpened(true);
    }
  }, [currentBlueprint, currentReviewReport, session.awaitInput?.phase]);

  useEffect(() => {
    if (!editor) return;

    const onSelectionUpdate = () => {
      const { selection } = editor.state;
      const { from, to, empty } = selection;
      if (empty) {
        setSelection("");
        setSelectionRange(null);
      } else if (selection instanceof NodeSelection) {
        const node = selection.node;
        setSelection(node.textContent || "");
        setSelectionRange({ from, to });
      } else {
        const text = editor.state.doc.textBetween(from, to, "\n");
        setSelection(text);
        setSelectionRange({ from, to });
      }
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    onSelectionUpdate();

    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor, setSelection, setSelectionRange]);

  const handleClose = () => {
    setAsideState({ tab: "", isAsideOpen: false });
  };

  const handleNewChat = () => {
    session.resetConversation();
  };

  const handleBlockedAction = (resolution: string) => {
    const action = resolveBlockedWorkbenchAction({
      resolution,
      hasBlueprint: Boolean(currentBlueprint),
      hasReview: Boolean(currentReviewReport),
    });

    if (action.kind === "open_review") {
      setReviewOpened(true);
      return;
    }

    if (action.kind === "open_blueprint") {
      setBlueprintOpened(true);
      return;
    }

    session.resume(action.resumeValue);
  };

  return (
    <div className={classes.panelRoot}>
      <div className={classes.panelHeader}>
        <Group gap="xs">
          <img src="/icons/app-icon-192x192.png" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          <Text fw={600} size="sm">
            {t("AI Assistant")}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label={t("New conversation")} openDelay={300}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleNewChat}>
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClose}>
            <IconX size={16} />
          </ActionIcon>
        </Group>
      </div>

      <div className={classes.panelBody}>
        <DocumentOperationCenter
          status={session.status}
          sourceScope={session.documentTask.sourceScope}
          mode={formatDocumentTaskMode(session.documentTask.mode)}
          deepCollaborationEnabled={session.documentTask.deepCollaborationEnabled}
          onToggleDeepCollaboration={session.toggleDeepCollaboration}
          taskSummary={
            session.documentTask.taskSummary.summary ||
            currentBrief?.goal ||
            t("No active document task yet.")
          }
          steps={session.steps}
          brief={session.awaitInput?.phase === "brief" ? currentBrief : null}
          assetSummary={session.awaitInput?.phase === "brief" ? currentAssetSummary : undefined}
          onConfirmBrief={(brief) => {
            session.resume({
              type: "confirm_brief",
              brief: brief as unknown as Record<string, unknown>,
            });
          }}
          onOpenBlueprint={
            session.awaitInput?.phase === "blueprint" && currentBlueprint
              ? () => setBlueprintOpened(true)
              : undefined
          }
          onOpenReview={
            session.awaitInput?.phase === "review" && currentReviewReport
              ? () => setReviewOpened(true)
              : undefined
          }
          plan={
            currentBlueprint
              ? {
                  title: currentBlueprint.title,
                  sections: currentBlueprint.sections.map((section) => section.title),
                }
              : session.documentTask.plan
          }
          diffSet={session.documentTask.diffSet as Array<{
            diffId: string;
            label: string;
            granularity: string;
          }>}
          pendingChangeCount={session.documentTask.pendingChangeSet.length}
          canApply={session.applyRollback.canApply}
          canRollback={session.applyRollback.canRollback}
          onApplyPendingChanges={session.applyAcceptedChanges}
          onRollbackSnapshot={session.rollbackAcceptedChanges}
          onConfirmExpertCollab={
            session.expertCollab.status === "awaiting_decision"
              ? handleExpertCollabConfirm
              : undefined
          }
          onReviseExpertCollab={
            session.expertCollab.status === "awaiting_decision"
              ? handleExpertCollabRevise
              : undefined
          }
          expertCollab={
            session.expertCollab.status === "awaiting_decision"
              ? {
                  reason: session.expertCollab.reason,
                  question: session.expertCollab.question,
                  options: session.expertCollab.options as Array<{
                    id?: string;
                    label?: string;
                  }>,
                  recommendedOption: session.expertCollab.recommendedOption,
                }
              : null
          }
        />
      </div>

      {shouldRenderWorkbenchModal({
        opened: blueprintOpened,
        hasData: Boolean(currentBlueprint),
        awaitPhase: session.awaitInput?.phase ?? null,
        expectedPhase: "blueprint",
        isBlocked: session.status === "blocked",
      }) && currentBlueprint && (
        <BlueprintModal
          opened={blueprintOpened}
          onClose={() => setBlueprintOpened(false)}
          blueprint={currentBlueprint}
          onConfirm={(blueprint) => {
            session.resume({
              type: "confirm_blueprint",
              blueprint: blueprint as unknown as Record<string, unknown>,
            });
            setBlueprintOpened(false);
          }}
          onRegenerate={() => {
            session.resume({ type: "apply_blueprint_patch", blueprint: null });
            setBlueprintOpened(false);
          }}
        />
      )}

      {shouldRenderWorkbenchModal({
        opened: reviewOpened,
        hasData: Boolean(currentReviewReport),
        awaitPhase: session.awaitInput?.phase ?? null,
        expectedPhase: "review",
        isBlocked: session.status === "blocked",
      }) && currentReviewReport && (
        <ReviewModal
          opened={reviewOpened}
          onClose={() => setReviewOpened(false)}
          report={currentReviewReport}
          onFixSelected={(ids, feedback) => {
            session.resume({ type: "fix_selected_issues", selected_issue_ids: ids, feedback });
            setReviewOpened(false);
          }}
          onContinue={(feedback) => {
            session.resume({ type: "accept_review", feedback });
            setReviewOpened(false);
          }}
          onSkip={() => {
            const visualIssueId =
              currentReviewReport.issues.find((issue) => issue.category === "visual" && !issue.fixed)?.id;
            if (!visualIssueId) {
              return;
            }
            session.resume({ type: "skip_issue", issue_id: visualIssueId });
            setReviewOpened(false);
          }}
        />
      )}

      {hasSelection && <AiCreatorSelection />}

      <AiCreatorInput
        isStreaming={session.isStreaming}
        status={session.status}
        onSubmit={session.submit}
        onStop={session.cancel}
      />
    </div>
  );
}
