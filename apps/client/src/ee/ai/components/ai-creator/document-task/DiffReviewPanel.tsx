import React from "react";
import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface DiffEntry {
  diffId: string;
  label: string;
  granularity: string;
}

interface DiffReviewPanelProps {
  taskSummary: string;
  plan?: Record<string, unknown> | null;
  diffSet: DiffEntry[];
}

export function DiffReviewPanel({
  taskSummary,
  plan,
  diffSet,
}: DiffReviewPanelProps) {
  const { t } = useTranslation();
  const planTitle =
    typeof plan?.title === "string" ? plan.title : null;
  const planSections = Array.isArray(plan?.sections)
    ? plan.sections.map((item) => String(item))
    : [];

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="md">
        <Paper withBorder radius="md" p="sm">
          <Stack gap={4}>
            <Group justify="space-between" align="flex-start">
              <Text fw={600} size="sm">
                {t("Structured Task Summary")}
              </Text>
              <Badge variant="outline">{diffSet.length}</Badge>
            </Group>
            <Text size="sm" c={taskSummary ? undefined : "dimmed"}>
              {taskSummary || t("No document task summary yet.")}
            </Text>
          </Stack>
        </Paper>

        {planTitle || planSections.length > 0 ? (
          <Paper withBorder radius="md" p="sm">
            <Stack gap={6}>
              <Text fw={600} size="sm">
                {t("Plan Preview")}
              </Text>
              {planTitle ? <Text size="sm">{planTitle}</Text> : null}
              {planSections.length > 0 ? (
                <Group gap="xs">
                  {planSections.map((section) => (
                    <Badge key={section} variant="outline">
                      {section}
                    </Badge>
                  ))}
                </Group>
              ) : null}
            </Stack>
          </Paper>
        ) : null}

        <Stack gap={6}>
          <Group justify="space-between" align="center">
            <Text fw={600} size="sm">
              {t("Diff Review")}
            </Text>
            <Badge variant="light">{diffSet.length}</Badge>
          </Group>
          {diffSet.length > 0 ? (
            <Stack gap="xs">
              {diffSet.map((entry) => (
                <Paper key={entry.diffId} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Text size="sm">{entry.label}</Text>
                    <Badge variant="light">{entry.granularity}</Badge>
                  </Group>
                </Paper>
              ))}
            </Stack>
          ) : (
            <Paper withBorder radius="md" p="sm">
              <Text size="sm" c="dimmed">
                {t("Diff set will appear here after the task generates reviewable changes.")}
              </Text>
            </Paper>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
