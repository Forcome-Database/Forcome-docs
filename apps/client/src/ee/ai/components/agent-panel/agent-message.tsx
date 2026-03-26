import { Alert, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { AgentMessage as AgentMessageType } from "../../types/agent-v2.types";
import { ToolCallStep } from "./tool-call-step";
import { StreamingMarkdown } from "./streaming-markdown";
import classes from "./agent-panel.module.css";

interface AgentMessageProps {
  message: AgentMessageType;
}

export function AgentMessage({ message }: AgentMessageProps) {
  return (
    <div className={classes.agentMessage}>
      <Stack gap={4}>
        {message.toolSteps?.map((step) => (
          <ToolCallStep key={step.id} step={step} />
        ))}

        {message.content && (
          <StreamingMarkdown
            content={message.content}
            streaming={message.streaming}
          />
        )}

        {message.warnings && message.warnings.length > 0 && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            variant="light"
            p="xs"
          >
            {message.warnings.map((w, i) => (
              <Text key={i} size="xs">{w}</Text>
            ))}
          </Alert>
        )}
      </Stack>
    </div>
  );
}
