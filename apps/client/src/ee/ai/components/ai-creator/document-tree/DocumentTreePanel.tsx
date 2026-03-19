import React from "react";
import { Badge, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import type { AgentDraftPatchSection } from "@/ee/ai/types/agent.types";
import type { AiCreateSessionStatus } from "../ai-create-session.types";

interface DocumentTreePanelProps {
  sections: AgentDraftPatchSection[];
  status: AiCreateSessionStatus;
}

function getSectionStatusLabel(
  section: AgentDraftPatchSection,
  status: AiCreateSessionStatus,
): { label: string; color: string } {
  if (!section.content.trim()) {
    return status === "running"
      ? { label: "Writing", color: "blue" }
      : { label: "Pending", color: "gray" };
  }

  if (status === "running") {
    return { label: "Drafted", color: "blue" };
  }

  if (status === "awaiting_input" || status === "blocked") {
    return { label: "Needs review", color: "orange" };
  }

  return { label: "Ready", color: "teal" };
}

function countApproximateWords(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function formatImageStatus(status?: string): string | null {
  if (!status) {
    return null;
  }

  switch (status) {
    case "source_reused":
      return "source_reused";
    case "generated":
      return "generated";
    case "generated_fallback":
      return "generated_fallback";
    case "missing_source":
      return "missing_source";
    case "generation_failed":
      return "generation_failed";
    default:
      return status;
  }
}

export function DocumentTreePanel({
  sections,
  status,
}: DocumentTreePanelProps) {
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Stack gap="sm" h="100%">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Document Tree
          </Text>
          <Badge variant="light">{sections.length} sections</Badge>
        </Group>
        <ScrollArea flex={1}>
          <Stack gap="xs">
            {sections.length === 0 ? (
              <Text size="xs" c="dimmed">
                Section nodes will appear here once the draft starts writing.
              </Text>
            ) : (
              sections.map((section) => {
                const sectionStatus = getSectionStatusLabel(section, status);
                return (
                  <Paper key={section.nodeId} withBorder radius="sm" p="sm">
                    <Stack gap={6}>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text size="xs" c="dimmed">
                            {"#".repeat(section.level)} node
                          </Text>
                          <Text size="sm" fw={500}>
                            {section.title}
                          </Text>
                        </div>
                        <Badge size="xs" color={sectionStatus.color} variant="light">
                          {sectionStatus.label}
                        </Badge>
                      </Group>
                      <Group gap="xs">
                        <Badge size="xs" variant="outline">
                          {countApproximateWords(section.content)} words
                        </Badge>
                        {section.writeAttempts ? (
                          <Badge size="xs" variant="outline">
                            {section.writeAttempts} attempts
                          </Badge>
                        ) : null}
                        {formatImageStatus(section.imageStatus) ? (
                          <Badge size="xs" variant="outline">
                            {formatImageStatus(section.imageStatus)}
                          </Badge>
                        ) : null}
                        <Badge size="xs" variant="outline">
                          {section.sectionId}
                        </Badge>
                      </Group>
                      {section.degradedReason ? (
                        <Text size="xs" c="dimmed">
                          {section.degradedReason}
                        </Text>
                      ) : null}
                    </Stack>
                  </Paper>
                );
              })
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </Paper>
  );
}
