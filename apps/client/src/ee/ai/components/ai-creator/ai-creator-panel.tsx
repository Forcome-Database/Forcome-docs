import { useDeferredValue, useEffect, useCallback, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconX, IconPlus } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { NodeSelection } from "@tiptap/pm/state";
import DOMPurify from "dompurify";
import { markdownToHtml } from "@docmost/editor-ext";
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
import { AiCreatorMessages } from "./ai-creator-messages";
import { AiCreatorInput } from "./ai-creator-input";
import { useAiCreateSession } from "@/ee/ai/hooks/use-ai-create-session";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { usePageQuery } from "@/features/page/queries/page-query";
import { BUBBLE_ALLOWED_URI_REGEXP } from "./ai-creator-bubble-render";
import { BlockedResolutionCard } from "./blocked/BlockedResolutionCard";
import { BlueprintModal } from "./blueprint/BlueprintModal";
import { DocumentTreePanel } from "./document-tree/DocumentTreePanel";
import { ReviewModal } from "./review/ReviewModal";
import { SmartBriefCard } from "./smart-brief/SmartBriefCard";
import {
  resolveBlockedWorkbenchAction,
  shouldRenderWorkbenchModal,
} from "./ai-creator-workbench";
import classes from "./ai-creator.module.css";

function renderDraftPreview(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }

  try {
    return DOMPurify.sanitize(markdownToHtml(markdown) as string, {
      ALLOWED_URI_REGEXP: BUBBLE_ALLOWED_URI_REGEXP,
    });
  } catch {
    return DOMPurify.sanitize(markdown, {
      ALLOWED_URI_REGEXP: BUBBLE_ALLOWED_URI_REGEXP,
    });
  }
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
  const deferredDraftMarkdown = useDeferredValue(session.draftMarkdown);
  const activityMessages = session.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
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
  const draftPreviewHtml = renderDraftPreview(deferredDraftMarkdown);

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
        <div className={classes.workbenchShell}>
          <div className={classes.workbenchColumnLeft}>
            <DocumentTreePanel
              sections={session.draftSections}
              status={session.status}
            />
          </div>

          <div className={classes.workbenchColumnCenter}>
            <Paper withBorder radius="md" className={classes.workbenchPanel}>
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  Live Draft
                </Text>
                <Badge variant="light" color={session.isStreaming ? "blue" : "gray"}>
                  {session.status}
                </Badge>
              </Group>
              <ScrollArea className={classes.workbenchScrollArea} scrollbarSize={5} type="scroll">
                {draftPreviewHtml ? (
                  <div
                    className={classes.workbenchDraftPreview}
                    dangerouslySetInnerHTML={{ __html: draftPreviewHtml }}
                  />
                ) : (
                  <Text size="sm" c="dimmed">
                    Draft content will stream here as the session writes sections.
                  </Text>
                )}
              </ScrollArea>
            </Paper>
          </div>

          <div className={classes.workbenchColumnRight}>
            <Stack gap="sm" h="100%">
              {session.evidenceSummary && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap={6}>
                    <Text fw={600} size="sm">
                      Evidence
                    </Text>
                    <Group gap="xs">
                      <Badge variant="outline">{session.evidenceSummary.total} total</Badge>
                      <Badge variant="outline">{session.evidenceSummary.requiredTotal} required</Badge>
                      <Badge
                        variant="light"
                        color={session.evidenceSummary.failedRequired > 0 ? "red" : "teal"}
                      >
                        {session.evidenceSummary.failedRequired} failed
                      </Badge>
                    </Group>
                  </Stack>
                </Paper>
              )}

              {session.block && (
                <BlockedResolutionCard
                  block={session.block}
                  onAction={handleBlockedAction}
                />
              )}

              {currentBrief && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        Brief
                      </Text>
                      <Badge variant="light">
                        {session.awaitInput?.phase === "brief" ? "Needs approval" : "Locked"}
                      </Badge>
                    </Group>
                    {session.awaitInput?.phase === "brief" && session.awaitInput.data.type === "brief" ? (
                      <SmartBriefCard
                        brief={currentBrief}
                        assetSummary={currentAssetSummary}
                        onConfirm={(brief) =>
                          session.resume({
                            type: "confirm_brief",
                            brief: brief as unknown as Record<string, unknown>,
                          })
                        }
                      />
                    ) : (
                      <>
                        <Text size="sm">{currentBrief.goal}</Text>
                        <Group gap="xs">
                          <Badge variant="outline">{currentBrief.audience}</Badge>
                          <Badge variant="outline">{currentBrief.style}</Badge>
                          <Badge variant="outline">{currentBrief.target_length} words</Badge>
                        </Group>
                      </>
                    )}
                  </Stack>
                </Paper>
              )}

              {currentBlueprint && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        Blueprint
                      </Text>
                      <Badge variant="light">
                        {session.awaitInput?.phase === "blueprint" ? "Needs approval" : "Ready"}
                      </Badge>
                    </Group>
                    <Text size="sm">{currentBlueprint.title}</Text>
                    <Group gap="xs">
                      <Badge variant="outline">{currentBlueprint.sections.length} sections</Badge>
                      <Badge variant="outline">{currentBlueprint.total_word_budget} words</Badge>
                    </Group>
                    {session.awaitInput?.phase === "blueprint" && (
                      <Button size="xs" variant="light" onClick={() => setBlueprintOpened(true)}>
                        Review blueprint
                      </Button>
                    )}
                  </Stack>
                </Paper>
              )}

              {currentReviewReport && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        Review
                      </Text>
                      <Badge
                        variant="light"
                        color={currentReviewReport.user_decision_needed.length > 0 ? "orange" : "teal"}
                      >
                        {currentReviewReport.overall_score}
                      </Badge>
                    </Group>
                    <Group gap="xs">
                      <Badge variant="outline">{currentReviewReport.issues.length} issues</Badge>
                      <Badge variant="outline">{currentReviewReport.auto_fixed_count} auto-fixed</Badge>
                    </Group>
                    {session.awaitInput?.phase === "review" && (
                      <Button size="xs" variant="light" onClick={() => setReviewOpened(true)}>
                        Open review
                      </Button>
                    )}
                  </Stack>
                </Paper>
              )}

              <Paper withBorder radius="md" className={classes.workbenchPanel}>
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">
                    Activity Log
                  </Text>
                  <Badge variant="light">{activityMessages.length}</Badge>
                </Group>
                <ScrollArea className={classes.workbenchScrollArea} scrollbarSize={5} type="scroll">
                  {activityMessages.length > 0 ? (
                    <AiCreatorMessages
                      messages={activityMessages}
                      isStreaming={session.isStreaming}
                      agentSteps={session.steps}
                      onResume={session.resume}
                    />
                  ) : (
                    <Text size="sm" c="dimmed">
                      Session activity will appear here while the workbench keeps the current decision cards on the right.
                    </Text>
                  )}
                </ScrollArea>
              </Paper>
            </Stack>
          </div>
        </div>
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
