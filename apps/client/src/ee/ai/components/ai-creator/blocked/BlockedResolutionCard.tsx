import React from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { AgentBlockState } from "@/ee/ai/types/agent.types";

interface BlockedResolutionCardProps {
  block: AgentBlockState;
  onAction?: (resolution: string) => void;
}

const RESOLUTION_LABELS: Record<string, string> = {
  retry: "Retry",
  remove_source: "Remove source",
  fix_selected_issues: "Open review",
  skip_visual_issues: "Review visuals",
  update_brief: "Update brief",
  update_blueprint: "Update blueprint",
};

function getResolutionLabel(resolution: string): string {
  return RESOLUTION_LABELS[resolution] ?? resolution.replace(/_/g, " ");
}

export function BlockedResolutionCard({
  block,
  onAction,
}: BlockedResolutionCardProps) {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text fw={600} size="sm">
            Blocked
          </Text>
          <Badge color="orange" variant="light">
            {block.kind}
          </Badge>
        </Group>
        <Text size="sm">{block.message}</Text>
        {block.requiredAction && (
          <Text size="xs" c="dimmed">
            {block.requiredAction}
          </Text>
        )}
        {block.allowedResolutions.length > 0 && (
          <Group gap="xs">
            {block.allowedResolutions.map((resolution) => (
              <Button
                key={resolution}
                size="compact-xs"
                variant="light"
                disabled={!onAction}
                onClick={() => onAction?.(resolution)}
              >
                {getResolutionLabel(resolution)}
              </Button>
            ))}
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
