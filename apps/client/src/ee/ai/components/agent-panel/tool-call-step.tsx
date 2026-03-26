import { Group, Loader, Text, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { ToolStep } from "../../types/agent-v2.types";
import classes from "./agent-panel.module.css";

interface ToolCallStepProps {
  step: ToolStep;
}

export function ToolCallStep({ step }: ToolCallStepProps) {
  return (
    <Group gap={8} className={classes.toolStep}>
      {step.status === "running" ? (
        <Loader size={14} />
      ) : (
        <ThemeIcon size={18} radius="xl" color="teal" variant="light">
          <IconCheck size={12} />
        </ThemeIcon>
      )}
      <Text size="xs" c="dimmed">
        {step.description}
      </Text>
    </Group>
  );
}
