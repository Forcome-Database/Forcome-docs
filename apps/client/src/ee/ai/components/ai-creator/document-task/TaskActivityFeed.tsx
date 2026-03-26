import React, { useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useInterval } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import type { AgentStepInfo } from "@/ee/ai/types/agent.types";

interface TaskActivityFeedProps {
  steps: AgentStepInfo[];
  defaultExpanded?: boolean;
}

function statusColor(status: AgentStepInfo["status"]): string {
  switch (status) {
    case "done":
      return "green";
    case "running":
      return "blue";
    case "error":
      return "red";
    default:
      return "gray";
  }
}

function formatStatusLabel(
  status: AgentStepInfo["status"],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (status) {
    case "done":
      return t("Done");
    case "running":
      return t("Running");
    case "error":
      return t("Error");
    default:
      return t("Pending");
  }
}

function formatStepLabel(
  step: AgentStepInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (step.description?.trim()) {
    return step.description;
  }

  if (step.step?.startsWith("write_section")) {
    const num = step.step.replace(/write_section_?/, "");
    return t("Writing section") + (num ? ` ${num}` : "");
  }

  switch (step.step) {
    case "parse_assets":
      return t("Parse uploaded source files");
    case "preservation_patch":
      return t("Generate the preservation patch");
    case "create_brief":
      return t("Build the working brief");
    case "create_blueprint":
      return t("Prepare the execution blueprint");
    case "review":
      return t("Review generated changes");
    case "finalize":
      return t("Prepare apply package");
    case "research":
      return t("Researching online sources");
    case "simple_edit":
      return t("Editing content");
    case "consistency_check":
      return t("Checking consistency");
    case "evaluate":
      return t("Evaluating quality");
    default:
      return step.step?.replace(/_/g, " ") ?? t("Processing");
  }
}

function formatElapsed(startTime?: number): string {
  if (!startTime) return "";
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}

export function TaskActivityFeed({
  steps,
  defaultExpanded = false,
}: TaskActivityFeedProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const [, setTick] = useState(0);
  const interval = useInterval(() => setTick((tick) => tick + 1), 1000);

  useEffect(() => {
    const hasRunning = steps.some((s) => s.status === "running");
    if (hasRunning) {
      interval.start();
    } else {
      interval.stop();
    }
    return () => interval.stop();
  }, [steps]);

  const visibleSteps = useMemo(() => {
    if (expanded) {
      return steps;
    }
    return steps.length > 0 ? [steps[steps.length - 1]] : [];
  }, [expanded, steps]);

  const hiddenCount = Math.max(steps.length - visibleSteps.length, 0);
  const hiddenUpdatesLabel = t("{{count}} earlier updates hidden", {
    count: hiddenCount,
  }).replace("{{count}}", String(hiddenCount));

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {t("Agent progress")}
            </Text>
            <Text size="xs" c="dimmed">
              {expanded ? t("All task updates are visible.") : t("Latest update")}
            </Text>
          </Stack>
          {steps.length > 1 ? (
            <Button
              size="xs"
              variant="subtle"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? t("Show latest only") : t("Show all updates")}
            </Button>
          ) : null}
        </Group>

        {visibleSteps.length > 0 ? (
          <Stack gap="xs">
            {visibleSteps.map((step, index) => (
              <Group
                key={`${step.step}-${step.status}-${index}`}
                align="stretch"
                wrap="nowrap"
                style={{
                  borderLeft:
                    index === visibleSteps.length - 1
                      ? "3px solid var(--mantine-color-blue-5)"
                      : undefined,
                  paddingLeft:
                    index === visibleSteps.length - 1 ? 8 : undefined,
                }}
              >
                <Stack gap={4} align="center" pt={4}>
                  <Box
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "999px",
                      backgroundColor: `var(--mantine-color-${statusColor(step.status)}-6)`,
                      flexShrink: 0,
                    }}
                  />
                  {index < visibleSteps.length - 1 ? (
                    <Box
                      style={{
                        width: 2,
                        minHeight: 34,
                        borderRadius: 999,
                        backgroundColor: "var(--mantine-color-gray-3)",
                        flex: 1,
                      }}
                    />
                  ) : null}
                </Stack>
                <Paper withBorder radius="md" p="sm" style={{ flex: 1 }}>
                  <Stack gap={6}>
                    <Group justify="space-between" align="center">
                      <Text fw={500} size="sm">
                        {formatStepLabel(step, t)}
                      </Text>
                      <Group gap="xs" wrap="nowrap">
                        {step.startTime && (
                          <Text size="xs" c="dimmed">
                            {formatElapsed(step.startTime)}
                          </Text>
                        )}
                        <Badge color={statusColor(step.status)} variant="light">
                          {formatStatusLabel(step.status, t)}
                        </Badge>
                      </Group>
                    </Group>
                    {step.resultSummary ? (
                      <Text size="xs" c="dimmed">
                        {step.resultSummary}
                      </Text>
                    ) : null}
                  </Stack>
                </Paper>
              </Group>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            {t("Waiting for agent progress.")}
          </Text>
        )}

        {!expanded && hiddenCount > 0 ? (
          <Text size="xs" c="dimmed">
            {hiddenUpdatesLabel}
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}
