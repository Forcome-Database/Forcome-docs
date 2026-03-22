import React from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface DocumentTaskHeaderProps {
  status: string;
  sourceScope: string;
  mode: string;
  deepCollaborationEnabled: boolean;
  onToggleDeepCollaboration?: () => void;
}

export function DocumentTaskHeader({
  status,
  sourceScope,
  mode,
  deepCollaborationEnabled,
  onToggleDeepCollaboration,
}: DocumentTaskHeaderProps) {
  const { t } = useTranslation();

  const statusLabel =
    {
      idle: t("Idle"),
      running: t("Running"),
      awaiting_input: t("Awaiting input"),
      blocked: t("Blocked"),
      completed: t("Completed"),
      error: t("Error"),
      cancelled: t("Cancelled"),
      active: t("Active"),
      hydrated: t("Restored"),
    }[status] ?? status;

  const sourceScopeLabel =
    {
      uploaded_document: t("Uploaded document"),
      uploaded_plus_current_page: t("Uploaded document + current page"),
      current_page: t("Current page"),
      blank_page: t("Blank page"),
      selection: t("Selection"),
    }[sourceScope] ?? sourceScope;

  const modeLabel =
    {
      strict_preservation: t("Strict preservation"),
      relaxed_optimization: t("Relaxed optimization"),
    }[mode] ?? mode;

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      style={{
        background:
          "linear-gradient(180deg, rgba(15, 23, 42, 0.02) 0%, rgba(15, 23, 42, 0) 100%)",
      }}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <Text fw={700} size="sm">
                {t("Document Task")}
              </Text>
              <Badge variant="light">{statusLabel}</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {sourceScopeLabel}
            </Text>
          </Stack>
          {onToggleDeepCollaboration ? (
            <Button
              size="xs"
              variant={deepCollaborationEnabled ? "default" : "light"}
              onClick={onToggleDeepCollaboration}
            >
              {t("Workflow only")}
            </Button>
          ) : null}
        </Group>

        <Group grow align="stretch">
          <Paper withBorder radius="md" p="sm">
            <Stack gap={2}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                {t("Status")}
              </Text>
              <Text size="sm" fw={600}>
                {statusLabel}
              </Text>
            </Stack>
          </Paper>
          <Paper withBorder radius="md" p="sm">
            <Stack gap={2}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                {t("Source Scope")}
              </Text>
              <Text size="sm" fw={600}>
                {sourceScopeLabel}
              </Text>
            </Stack>
          </Paper>
          <Paper withBorder radius="md" p="sm">
            <Stack gap={2}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                {t("Mode")}
              </Text>
              <Text size="sm" fw={600}>
                {modeLabel}
              </Text>
            </Stack>
          </Paper>
        </Group>
      </Stack>
    </Paper>
  );
}
