import React, { useMemo } from "react";
import { Badge, Button, Group, Stack } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import type { AgentStepInfo } from "@/ee/ai/types/agent.types";
import type { AgentAssetSummary } from "@/ee/ai/types/agent.types";
import type { CreationBrief } from "@/ee/ai/types/brief.types";
import { useTranslation } from "react-i18next";
import { SmartBriefCard } from "../smart-brief/SmartBriefCard";
import { DocumentTaskHeader } from "./DocumentTaskHeader";
import { DiffReviewPanel } from "./DiffReviewPanel";
import { PendingChangeBar } from "./PendingChangeBar";
import { ExpertCollabPanel } from "../expert-collab/ExpertCollabPanel";
import { TaskActivityFeed } from "./TaskActivityFeed";

type Phase = "preparing" | "confirming" | "delivering";

interface DiffEntry {
  diffId: string;
  label: string;
  granularity: string;
}

interface DocumentOperationCenterProps {
  status: string;
  sourceScope: string;
  mode: string;
  steps?: AgentStepInfo[];
  defaultExpanded?: boolean;
  deepCollaborationEnabled?: boolean;
  onToggleDeepCollaboration?: () => void;
  taskSummary: string;
  brief?: CreationBrief | null;
  assetSummary?: AgentAssetSummary;
  onConfirmBrief?: (brief: CreationBrief) => void;
  onOpenBlueprint?: () => void;
  onOpenReview?: () => void;
  plan?: Record<string, unknown> | null;
  diffSet: DiffEntry[];
  pendingChangeCount: number;
  canApply: boolean;
  canRollback: boolean;
  onApplyPendingChanges?: () => void;
  onRollbackSnapshot?: () => void;
  onConfirmExpertCollab?: () => void;
  onReviseExpertCollab?: () => void;
  expertCollab?: {
    reason: string | null;
    question: string | null;
    options: Array<{ id?: string; label?: string }>;
    recommendedOption: string | null;
  } | null;
}

export function DocumentOperationCenter({
  status,
  sourceScope,
  mode,
  steps = [],
  defaultExpanded = false,
  deepCollaborationEnabled = true,
  onToggleDeepCollaboration,
  taskSummary,
  brief,
  assetSummary,
  onConfirmBrief,
  onOpenBlueprint,
  onOpenReview,
  plan,
  diffSet,
  pendingChangeCount,
  canApply,
  canRollback,
  onApplyPendingChanges,
  onRollbackSnapshot,
  onConfirmExpertCollab,
  onReviseExpertCollab,
  expertCollab,
}: DocumentOperationCenterProps) {
  const { t } = useTranslation();

  const currentPhase = useMemo<Phase>(() => {
    if (brief && onConfirmBrief) return "confirming";
    if (onOpenBlueprint || onOpenReview) return "confirming";
    if (status === "completed" || pendingChangeCount > 0) return "delivering";
    if (status === "error" || status === "cancelled") return "delivering";
    return "preparing";
  }, [status, brief, onConfirmBrief, onOpenBlueprint, onOpenReview, pendingChangeCount]);

  return (
    <div
      data-document-task-scroll-region="true"
      style={{ height: "100%", minHeight: 0, overflowY: "auto" }}
    >
      <Stack gap="sm">
        {/* DocumentTaskHeader: always visible */}
        <DocumentTaskHeader
          status={status}
          sourceScope={sourceScope}
          mode={mode}
          deepCollaborationEnabled={deepCollaborationEnabled}
          onToggleDeepCollaboration={onToggleDeepCollaboration}
        />

        {/* Phase indicator */}
        <Group gap={4} justify="center" mb="sm">
          <Badge
            variant={currentPhase === "preparing" ? "filled" : "light"}
            color={currentPhase === "preparing" ? "blue" : "gray"}
            size="sm"
          >
            {t("Preparing")}
          </Badge>
          <IconChevronRight size={12} color="gray" />
          <Badge
            variant={currentPhase === "confirming" ? "filled" : "light"}
            color={currentPhase === "confirming" ? "blue" : "gray"}
            size="sm"
          >
            {t("Confirming")}
          </Badge>
          <IconChevronRight size={12} color="gray" />
          <Badge
            variant={currentPhase === "delivering" ? "filled" : "light"}
            color={currentPhase === "delivering" ? "blue" : "gray"}
            size="sm"
          >
            {t("Delivering")}
          </Badge>
        </Group>

        {/* PREPARING phase: only activity feed */}
        {currentPhase === "preparing" && (
          <TaskActivityFeed steps={steps} defaultExpanded={defaultExpanded} />
        )}

        {/* CONFIRMING phase: brief/blueprint/review + expert collab + activity */}
        {currentPhase === "confirming" && (
          <>
            {brief && onConfirmBrief ? (
              <SmartBriefCard
                brief={brief}
                assetSummary={assetSummary}
                onConfirm={onConfirmBrief}
              />
            ) : null}
            {onOpenBlueprint || onOpenReview ? (
              <Group gap="xs">
                {onOpenBlueprint ? (
                  <Button size="xs" variant="default" onClick={onOpenBlueprint}>
                    {t("Review blueprint")}
                  </Button>
                ) : null}
                {onOpenReview ? (
                  <Button size="xs" variant="default" onClick={onOpenReview}>
                    {t("Open review")}
                  </Button>
                ) : null}
              </Group>
            ) : null}
            {deepCollaborationEnabled && expertCollab && onConfirmExpertCollab && (
              <ExpertCollabPanel
                reason={expertCollab.reason}
                question={expertCollab.question}
                options={expertCollab.options}
                recommendedOption={expertCollab.recommendedOption}
                onConfirm={onConfirmExpertCollab}
                onRevise={onReviseExpertCollab}
              />
            )}
            <TaskActivityFeed steps={steps} defaultExpanded={false} />
          </>
        )}

        {/* DELIVERING phase: activity + diff + pending changes */}
        {currentPhase === "delivering" && (
          <>
            <TaskActivityFeed steps={steps} defaultExpanded={false} />
            <DiffReviewPanel
              taskSummary={taskSummary}
              plan={plan}
              diffSet={diffSet}
            />
            <PendingChangeBar
              pendingChangeCount={pendingChangeCount}
              canApply={canApply}
              canRollback={canRollback}
              onApply={onApplyPendingChanges}
              onRollback={onRollbackSnapshot}
            />
          </>
        )}
      </Stack>
    </div>
  );
}
