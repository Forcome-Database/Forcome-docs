import React from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface PendingChangeBarProps {
  pendingChangeCount: number;
  canApply: boolean;
  canRollback: boolean;
  onApply?: () => void;
  onRollback?: () => void;
}

export function PendingChangeBar({
  pendingChangeCount,
  canApply,
  canRollback,
  onApply,
  onRollback,
}: PendingChangeBarProps) {
  const { t } = useTranslation();
  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      style={{
        background:
          pendingChangeCount > 0
            ? "linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)"
            : undefined,
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={4}>
          <Group gap="xs">
            <Text fw={700} size="sm">
              {t("Pending Changes")}
            </Text>
            <Badge variant="outline" size="lg">
              {pendingChangeCount}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {canApply ? t("Draft is ready. Apply it from Pending Changes.") : t("No active document task yet.")}
          </Text>
        </Stack>
        <Group gap="xs">
          <Button size="xs" variant="filled" disabled={!canApply} onClick={onApply}>
            {t("Apply accepted changes")}
          </Button>
          <Button size="xs" variant="default" disabled={!canRollback} onClick={onRollback}>
            {t("Rollback snapshot")}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
